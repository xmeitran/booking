'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { isUniqueError, optInt, str } from '@/lib/form';
import { refreshKoc } from '@/lib/creatorStats';
import { refreshKocAggregates } from '@/lib/bookingSync';
import { audit } from '@/lib/catalog';
import { parseHandle } from '@/lib/listing';
import { can, requirePerm, requireUser } from '@/lib/session';
import {
  accountError, ALL_BRANDS_SCOPE, CATEGORY_VALUES, cccdError, cleanHandle, CONTACT_CHANNELS, CONTACT_STATUS, DEFAULT_TAX_ACCOUNT, dateError, initialReadiness,
  LEGAL_TYPES, OTHER_PLATFORMS, placeError, profileCode, READINESS, REVIEW_REASONS, TIKTOK_ROLES, upperNoAccent, VERDICTS, type LegalType,
} from '@/lib/kocDirectory';
import { bankAccount, idNumber, phoneVN } from '@/lib/validate';
import { KL_LEVELS, PLATFORMS } from './platforms';

// ret chỉ là query string (?q=...) nối sau path cố định, không mở redirect ra ngoài.
const back = (fd: FormData) => {
  const ret = str(fd, 'ret');
  revalidatePath('/contacts');
  redirect('/contacts' + (ret.startsWith('?') ? ret : ''));
};

export async function saveKoc(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requirePerm('koc.edit');
  const id = str(fd, 'id');
  const platform = str(fd, 'platform');
  const rawHandle = str(fd, 'handle');
  const current = id ? await db.koc.findUnique({ where: { id }, select: { handle: true, platform: true } }) : null;
  // TikTok: nhận cả link kênh, chỉ chấp nhận username hợp lệ để khớp booking và tra được TikTok Shop.
  // Giữ nguyên ID cũ thì không kiểm lại (KOC từ Lark có ID không đúng chuẩn vẫn sửa được SĐT, địa chỉ...).
  const keep = current && rawHandle.replace(/^@/, '').toLowerCase() === current.handle;
  const handle = keep ? current.handle : platform === 'TikTok' ? parseHandle(rawHandle) ?? '' : rawHandle.replace(/^@/, '').toLowerCase();
  const name = str(fd, 'name');
  const channelUrl = str(fd, 'channelUrl') || null;
  const followers = optInt(fd, 'followers');
  const rateCard = optInt(fd, 'rateCard');

  if (!PLATFORMS.includes(platform)) return 'Nền tảng không hợp lệ.';
  if (platform === 'TikTok' && rawHandle && !handle) return 'ID kênh TikTok chỉ gồm chữ thường không dấu, số, dấu chấm, gạch dưới (2–24 ký tự), hoặc dán link kênh.';
  if (!handle || !name) return 'Nhập ID kênh và tên kênh.';
  if (channelUrl && !/^https?:\/\//i.test(channelUrl)) return 'Link kênh phải bắt đầu bằng http(s)://';
  if (Number.isNaN(followers) || Number.isNaN(rateCard)) return 'Follower và giá phải là số nguyên ≥ 0.';

  const phone = phoneVN(str(fd, 'phone'));
  const receiverPhone = phoneVN(str(fd, 'receiverPhone'));
  const account = bankAccount(str(fd, 'bankAccount'));
  const idNo = idNumber(str(fd, 'idNumber'));
  if (phone === undefined || receiverPhone === undefined) return 'SĐT phải là số Việt Nam 10 số (0xxxxxxxxx hoặc +84…).';
  if (account === undefined) return 'Số tài khoản chỉ gồm 6–19 chữ số.';
  if (idNo === undefined) return 'CCCD 12 số, CMND 9 số hoặc MST 10 / 13 số.';

  if (fd.get('blacklisted') === 'on' && !str(fd, 'blacklistReason')) return 'Ghi lý do đưa KOC vào blacklist.';

  const picId = str(fd, 'picId') || null;
  // Số TK / CCCD chỉ sửa ở đây khi người sửa được xem (quyền koc.bank) và KOC chưa có hồ sơ pháp lý; có hồ sơ thì sửa ở trang KOC.
  const profiles = id ? await db.kocLegalProfile.count({ where: { kocId: id } }) : 0;
  const bankEditable = fd.get('bankSection') === '1' && can(me, 'koc.bank') && !profiles;
  const data = {
    platform, handle, name, channelUrl, followers, rateCard,
    niche: str(fd, 'niche') || null,
    phone,
    zalo: str(fd, 'zalo') || null,
    email: str(fd, 'email') || null,
    note: str(fd, 'note') || null,
    tags: [...new Set(str(fd, 'tags').split(',').map((t) => t.trim()).filter(Boolean))].slice(0, 20),
    blacklisted: fd.get('blacklisted') === 'on',
    blacklistReason: fd.get('blacklisted') === 'on' ? str(fd, 'blacklistReason') || null : null,
    picId,
    kl: KL_LEVELS.includes(str(fd, 'kl')) ? str(fd, 'kl') : null,
    receiverName: str(fd, 'receiverName') || null,
    receiverPhone,
    address: str(fd, 'address') || null,
    ...(bankEditable && { bankHolder: str(fd, 'bankHolder') || null, bankAccount: account, bankName: str(fd, 'bankName') || null, idNumber: idNo }),
    category: CATEGORY_VALUES.includes(str(fd, 'category')) ? str(fd, 'category') : null,
  };
  // Đổi ID kênh TikTok: giữ ID cũ làm alias và đổi kênh ở booking (như gộp KOC), để booking không mất liên kết
  // và đồng bộ Lark sau không tạo lại KOC theo ID cũ.
  const renamed = current && current.platform === 'TikTok' && current.handle !== handle;
  try {
    if (id) {
      await db.$transaction([
        db.koc.update({ where: { id }, data }),
        ...(renamed ? [
          db.kocAlias.upsert({ where: { handle: current.handle }, create: { handle: current.handle, kocId: id }, update: { kocId: id } }),
          db.booking.updateMany({ where: { channel: { equals: current.handle, mode: 'insensitive' } }, data: { channel: handle } }),
        ] : []),
      ]);
      if (renamed) await refreshKocAggregates();
    } else await db.koc.create({ data: { ...data, readiness: initialReadiness(data) } });
  } catch (e) {
    if (isUniqueError(e)) return `Kênh @${handle} trên ${platform} đã có trong danh bạ.`;
    throw e;
  }
  back(fd);
  return null;
}

export async function deleteKoc(fd: FormData) {
  await requirePerm('koc.edit');
  const id = str(fd, 'id');
  // KOC đã có job (xoá sẽ lỗi khoá ngoại) hoặc nằm trong listing (xoá mất lựa chọn của Brand): gộp thay vì xoá.
  const used = await db.koc.findUniqueOrThrow({ where: { id }, select: { _count: { select: { jobs: true, listingItems: true } } } });
  if (used._count.jobs || used._count.listingItems) redirect(`/contacts/${id}?merge=${encodeURIComponent('KOC đã có job hoặc nằm trong listing, không xoá được. Nếu là hồ sơ trùng, gộp vào KOC kia.')}`);
  await db.koc.delete({ where: { id } });
  back(fd);
}

// Thông tin liên hệ / nhận hàng / thanh toán: KOC gộp vào còn trống thì lấy từ KOC bị gộp.
const FILL = ['channelUrl', 'followers', 'niche', 'phone', 'zalo', 'email', 'rateCard', 'note', 'picId', 'kl', 'receiverName', 'receiverPhone', 'address', 'bankHolder', 'bankAccount', 'bankName', 'idNumber'] as const;

/**
 * Gộp KOC trùng (cùng người, Lark ghi nhiều ID kênh): chuyển listing, job, ghi chú, quyết định matching, booking sang KOC giữ lại,
 * lưu ID cũ làm alias để lần đồng bộ Lark sau tự quy về, rồi xoá hồ sơ trùng.
 */
export async function mergeKoc(fd: FormData) {
  const me = await requirePerm('koc.edit');
  const src = await db.koc.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  const raw = str(fd, 'target').trim();
  const key = parseHandle(raw) ?? raw.replace(/^@/, '').toLowerCase();
  const dst = key ? await db.koc.findFirst({ where: { platform: src.platform, handle: key } }) : null;
  const fail = (m: string) => redirect(`/contacts/${src.id}?merge=${encodeURIComponent(m)}`);
  if (!dst) fail(`Không có KOC "${raw}" trong Danh bạ.`);
  if (dst!.id === src.id) fail('Chọn một KOC khác để gộp vào.');
  const clash = await db.listingItem.findFirst({ where: { kocId: src.id, batch: { items: { some: { kocId: dst!.id } } } }, select: { batch: { select: { name: true } } } });
  if (clash) fail(`Cả 2 KOC cùng nằm trong đợt listing "${clash.batch.name}": xoá bớt một dòng ở Listing rồi gộp lại.`);
  const to = dst!;
  const fill = Object.fromEntries(FILL.filter((k) => to[k] == null && src[k] != null).map((k) => [k, src[k]]));
  await db.$transaction([
    db.listingItem.updateMany({ where: { kocId: src.id }, data: { kocId: to.id } }),
    db.job.updateMany({ where: { kocId: src.id }, data: { kocId: to.id } }),
    db.kocNote.updateMany({ where: { kocId: src.id }, data: { kocId: to.id } }),
    db.$executeRaw`update "MatchDecision" set "kocId" = ${to.id} where "kocId" = ${src.id} and "briefId" not in (select "briefId" from "MatchDecision" where "kocId" = ${to.id})`,
    db.matchDecision.deleteMany({ where: { kocId: src.id } }),
    db.kocAlias.updateMany({ where: { kocId: src.id }, data: { kocId: to.id } }),
    db.kocAlias.upsert({ where: { handle: src.handle }, create: { handle: src.handle, kocId: to.id }, update: { kocId: to.id } }),
    db.booking.updateMany({ where: { channel: { equals: src.handle, mode: 'insensitive' } }, data: { channel: to.handle } }),
    db.koc.update({
      where: { id: to.id },
      data: { ...fill, tags: [...new Set([...to.tags, ...src.tags])], blacklisted: to.blacklisted || src.blacklisted, blacklistReason: to.blacklistReason ?? src.blacklistReason },
    }),
    db.koc.delete({ where: { id: src.id } }),
  ]);
  await refreshKocAggregates();
  await audit(me.id, 'Koc', to.id, 'Gộp KOC trùng', { from: src.handle, fromName: src.name });
  revalidatePath('/contacts');
  redirect(`/contacts/${to.id}?merge=ok`);
}

export async function refreshFromTikTok(fd: FormData) {
  await requireUser();
  const id = str(fd, 'id');
  let r: string;
  try {
    r = await refreshKoc(id);
  } catch {
    r = 'failed';
  }
  revalidatePath(`/contacts/${id}`);
  redirect(`/contacts/${id}?tiktok=${r}`);
}

// Nhật ký chăm sóc: mọi vai trò được ghi. Form dùng action trực tiếp nên React tự xoá ô nhập sau khi lưu.
export async function addNote(fd: FormData) {
  const me = await requireUser();
  const kocId = str(fd, 'kocId');
  const body = str(fd, 'body');
  const follow = str(fd, 'followUpAt');
  if (!kocId || !body) return;
  await db.kocNote.create({
    data: { kocId, authorId: me.id, body, followUpAt: /^\d{4}-\d{2}-\d{2}$/.test(follow) ? new Date(`${follow}T09:00:00+07:00`) : null },
  });
  revalidatePath(`/contacts/${kocId}`);
}

export async function closeFollowUp(fd: FormData) {
  await requireUser();
  const n = await db.kocNote.update({ where: { id: str(fd, 'id') }, data: { doneAt: new Date() } });
  revalidatePath(`/contacts/${n.kocId}`);
}

// ------------------------------------------------------------------ Danh bạ KOC / KOL: thao tác từng dòng (bản chốt b2c)

/** Quay lại đúng màn đang xem: next là query string (?tab=...&review=...) của /contacts hoặc đường dẫn /contacts/<id>. */
function goBack(fd: FormData, kocId?: string) {
  const next = str(fd, 'next');
  revalidatePath('/contacts');
  if (kocId) revalidatePath(`/contacts/${kocId}`);
  redirect(next.startsWith('?') ? `/contacts${next}` : /^\/contacts\/[\w-]+(\?[^\s]*)?$/.test(next) ? next : '/contacts');
}

/** Quản lý kênh & TikTok phụ: kênh TikTok chính giữ nguyên (khớp booking Lark), TikTok phụ và các nền tảng khác thay toàn bộ. */
export async function saveChannels(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requirePerm('koc.edit');
  const koc = await db.koc.findUnique({ where: { id: str(fd, 'kocId') }, select: { id: true, handle: true, idNumber: true } });
  if (!koc) return 'Không tìm thấy KOC.';
  const roles = TIKTOK_ROLES.map(([v]) => v as string);
  const list: { platform: string; handle: string; role: string | null }[] = [];
  const seen = new Set([`TikTok::${koc.handle}`]);
  const push = (platform: string, handle: string, role: string | null) => {
    const key = `${platform}::${handle}`;
    if (seen.has(key)) return platform === 'TikTok' ? `Kênh TikTok @${handle} đã tồn tại trong danh sách của KOC này.` : null;
    seen.add(key);
    list.push({ platform, handle, role });
    return null;
  };
  for (const h of fd.getAll('tt').map(String)) {
    if (fd.get(`rm-${h}`) === 'on') continue;
    const role = str(fd, `role-${h}`);
    push('TikTok', h, roles.includes(role) ? role : roles[0]);
  }
  const added = str(fd, 'newTt');
  if (added) {
    const h = parseHandle(added);
    if (!h) return 'Handle hoặc đường dẫn kênh TikTok không hợp lệ.';
    const role = str(fd, 'newRole');
    const err = push('TikTok', h, roles.includes(role) ? role : roles[0]);
    if (err) return err;
  }
  for (const p of OTHER_PLATFORMS) for (const raw of str(fd, p.key).split(/[,;\n]+/)) {
    const h = cleanHandle(raw);
    if (h) push(p.key, h, null);
  }
  // Kênh đang thuộc KOC khác (kênh chính, ID đã gộp hoặc kênh phụ); bỏ qua KOC cùng chủ (trùng CCCD / MST).
  const tt = list.filter((c) => c.platform === 'TikTok').map((c) => c.handle);
  const owner = (koc.idNumber ?? '').replace(/\D/g, '');
  const [primaries, aliases, others] = await Promise.all([
    db.koc.findMany({ where: { platform: 'TikTok', handle: { in: tt }, id: { not: koc.id } }, select: { handle: true, name: true, idNumber: true } }),
    db.kocAlias.findMany({ where: { handle: { in: tt }, kocId: { not: koc.id } }, select: { handle: true, koc: { select: { name: true, idNumber: true } } } }),
    db.kocChannel.findMany({ where: { kocId: { not: koc.id }, OR: list.map((c) => ({ platform: c.platform, handle: c.handle })) }, select: { platform: true, handle: true, koc: { select: { name: true, idNumber: true } } } }),
  ]);
  const sameOwner = (idn: string | null) => owner.length >= 9 && (idn ?? '').replace(/\D/g, '') === owner;
  const hit = [
    ...primaries.map((k) => ({ platform: 'TikTok', handle: k.handle, name: k.name, idNumber: k.idNumber })),
    ...aliases.map((a) => ({ platform: 'TikTok', handle: a.handle, name: a.koc.name, idNumber: a.koc.idNumber })),
    ...others.map((c) => ({ platform: c.platform, handle: c.handle, name: c.koc.name, idNumber: c.koc.idNumber })),
  ].find((c) => !sameOwner(c.idNumber));
  if (hit) return hit.platform === 'TikTok'
    ? `Kênh TikTok @${hit.handle} đang được gắn cho KOC khác (${hit.name}). Vui lòng kiểm tra hoặc gỡ khỏi KOC cũ trước.`
    : `Kênh ${hit.platform}: ${hit.handle} đang được gắn cho KOC khác (${hit.name}).`;
  await db.$transaction([
    db.kocChannel.deleteMany({ where: { kocId: koc.id } }),
    db.kocChannel.createMany({ data: list.map((c) => ({ ...c, kocId: koc.id })) }),
  ]);
  await audit(me.id, 'Koc', koc.id, `Cấu hình kênh (${list.length + 1} tài khoản)`, { channels: list });
  goBack(fd, koc.id);
  return null;
}

/** Ghi lịch sử liên hệ / Chốt hợp tác (KocOutreachModal). */
export async function logContact(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const koc = await db.koc.findUnique({ where: { id: str(fd, 'kocId') }, select: { id: true, zalo: true } });
  if (!koc) return 'Không tìm thấy KOC.';
  const contactStatus = str(fd, 'contactStatus');
  const readiness = str(fd, 'readiness');
  if (!CONTACT_STATUS.some(([v]) => v === contactStatus) || !READINESS[readiness]) return 'Chọn trạng thái liên hệ và độ sẵn sàng.';
  const phone = phoneVN(str(fd, 'phone'));
  if (phone === undefined) return 'SĐT phải là số Việt Nam 10 số (0xxxxxxxxx hoặc +84…).';
  const rateCard = optInt(fd, 'rateCard');
  if (Number.isNaN(rateCard)) return 'Báo giá phải là số nguyên ≥ 0.';
  const email = str(fd, 'email');
  const channel = CONTACT_CHANNELS.includes(str(fd, 'channel')) ? str(fd, 'channel') : null;
  const note = str(fd, 'note');
  const close = fd.get('close') === 'on';
  await db.$transaction([
    db.koc.update({
      where: { id: koc.id },
      data: {
        contactStatus, readiness,
        ...(phone && { phone, zalo: phone }),
        ...(email && { email }),
        ...(rateCard != null && { rateCard }),
        ...(str(fd, 'address') && { address: str(fd, 'address') }),
        ...(close && { coopConfirmed: true }),
      },
    }),
    ...(note ? [db.kocNote.create({ data: { kocId: koc.id, authorId: me.id, body: note, channel } })] : []),
  ]);
  await audit(me.id, 'Koc', koc.id, close ? 'Chốt hợp tác' : 'Ghi lịch sử liên hệ', { contactStatus, readiness, channel });
  goBack(fd, koc.id);
  return null;
}

/** Đánh giá kênh theo brand (KocChannelReviewModal). Không chọn lý do: lấy lý do đầu; ý kiến trống: ghép các lý do. */
export async function saveReview(_: string | null, fd: FormData): Promise<string | null> {
  const me = await requireUser();
  const kocId = str(fd, 'kocId');
  if (!(await db.koc.count({ where: { id: kocId } }))) return 'Không tìm thấy KOC.';
  const verdict = VERDICTS[str(fd, 'verdict')] ? str(fd, 'verdict') : 'NOT_SUITABLE';
  const brand = str(fd, 'brand') || ALL_BRANDS_SCOPE;
  if (brand !== ALL_BRANDS_SCOPE && !(await db.brand.count({ where: { name: brand } }))) return 'Chọn nhãn hàng (Brand) đánh giá.';
  const allowed = REVIEW_REASONS[verdict];
  const picked = fd.getAll(`reason-${verdict}`).map(String).filter((r) => allowed.includes(r));
  const reasons = picked.length ? picked : [allowed[0]];
  const note = str(fd, `note-${verdict}`).slice(0, 2000) || reasons.join(', ');
  await db.kocReview.create({ data: { kocId, verdict, brand, reasons, note, source: str(fd, 'source') || 'Danh bạ KOC', reviewerId: me.id } });
  goBack(fd, kocId);
  return null;
}

export async function deleteReview(fd: FormData) {
  const me = await requireUser();
  const r = await db.kocReview.findUnique({ where: { id: str(fd, 'id') } });
  if (!r) return;
  if (r.reviewerId !== me.id && !can(me, 'koc.edit')) throw new Error('Chỉ người đánh giá hoặc người có quyền sửa danh bạ KOC được xoá lượt đánh giá này.');
  await db.kocReview.delete({ where: { id: r.id } });
  await audit(me.id, 'Koc', r.kocId, 'Xoá lượt đánh giá kênh', { verdict: r.verdict, brand: r.brand });
  goBack(fd, r.kocId);
}


// ------------------------------------------------------------------ Hồ sơ pháp lý (1 KOC → N pháp nhân)

/** Hồ sơ mặc định chép ngược vào cột cũ của Koc để ĐNTT, listing, job, đồng bộ Lark dùng như trước. */
async function mirrorDefault(kocId: string) {
  const all = await db.kocLegalProfile.findMany({ where: { kocId }, orderBy: { code: 'asc' } });
  if (!all.length) return;
  let def = all.find((p) => p.isDefault);
  if (!def) {
    def = all[0];
    await db.kocLegalProfile.update({ where: { id: def.id }, data: { isDefault: true } });
  }
  await db.koc.update({
    where: { id: kocId },
    data: {
      idNumber: def.cccd || def.taxCode || def.businessLicenseNo || null,
      bankAccount: def.bankAccount, bankName: def.bankName,
      bankHolder: def.bankHolderName || (def.holderName ? upperNoAccent(def.holderName) : null),
    },
  });
}

async function legalEditor() {
  const me = await requirePerm('koc.edit');
  if (!can(me, 'koc.bank')) redirect('/');
  return me;
}

export async function saveLegalProfile(_: string | null, fd: FormData): Promise<string | null> {
  const me = await legalEditor();
  const kocId = str(fd, 'kocId');
  const id = str(fd, 'id');
  const koc = await db.koc.findUnique({ where: { id: kocId }, include: { legalProfiles: true } });
  if (!koc) return 'Không tìm thấy KOC.';
  const legalType = (LEGAL_TYPES.includes(str(fd, 'legalType') as LegalType) ? str(fd, 'legalType') : 'INDIVIDUAL') as LegalType;
  const holderName = str(fd, 'holderName');
  const cccd = str(fd, 'cccd').replace(/\s/g, '');
  const taxCode = str(fd, 'taxCode');
  const businessLicenseNo = str(fd, 'businessLicenseNo');
  const cccdIssueDate = str(fd, 'cccdIssueDate');
  const cccdIssuePlace = str(fd, 'cccdIssuePlace');
  const bankAccountNo = str(fd, 'bankAccount').replace(/\s+/g, '');
  const bankHolderName = str(fd, 'bankHolderName') ? upperNoAccent(str(fd, 'bankHolderName')) : '';
  if (!holderName) return legalType === 'INDIVIDUAL' ? 'Nhập Họ và tên cá nhân đứng tên Hợp đồng.' : 'Nhập Tên pháp nhân Công ty / Hộ kinh doanh.';
  if (legalType === 'INDIVIDUAL') {
    if (!cccd) return 'Hồ sơ pháp lý Cá nhân bắt buộc phải nhập Số CCCD (12 chữ số).';
    const e = cccdError(cccd) ?? (cccdIssueDate && dateError(cccdIssueDate)) ?? (cccdIssuePlace && placeError(cccdIssuePlace));
    if (e) return e;
  } else if (!taxCode && !businessLicenseNo) return 'Hồ sơ pháp lý Hộ kinh doanh / Công ty bắt buộc phải nhập Mã số thuế hoặc Số Giấy phép ĐKKD.';
  if (bankAccountNo && accountError(bankAccountNo)) return accountError(bankAccountNo);
  const contractStatus = ['CHƯA_KÝ', 'ĐANG_TRÌNH_KÝ', 'ĐÃ_KÝ', 'HẾT_HẠN'].includes(str(fd, 'contractStatus')) ? str(fd, 'contractStatus') : 'CHƯA_KÝ';
  const contractUrl = str(fd, 'contractUrl');
  if (contractUrl && !/^https?:\/\//i.test(contractUrl)) return 'Link file HĐNT phải bắt đầu bằng http(s)://';
  const vat = Number(str(fd, 'vatRatePercent'));
  const individual = legalType === 'INDIVIDUAL';
  const data = {
    legalType, holderName,
    taxAccountType: str(fd, 'taxAccountType') || DEFAULT_TAX_ACCOUNT[legalType],
    signRole: str(fd, 'signRole') || null,
    cccd: individual ? cccd : cccd || null,
    cccdIssueDate: individual ? cccdIssueDate || null : null,
    cccdIssuePlace: individual ? cccdIssuePlace || null : null,
    taxCode: taxCode || null,
    businessLicenseNo: individual ? null : businessLicenseNo || null,
    representativeName: str(fd, 'representativeName') || null,
    representativeTitle: str(fd, 'representativeTitle') || null,
    authorizationNumber: str(fd, 'authorizationNumber') || null,
    authorizationDate: str(fd, 'authorizationDate') || null,
    vatRatePercent: individual || Number.isNaN(vat) ? null : vat,
    contactPhone: str(fd, 'contactPhone') || null,
    contactEmail: str(fd, 'contactEmail') || null,
    address: str(fd, 'address') || null,
    bankName: str(fd, 'bankName') || null,
    bankAccount: bankAccountNo || null,
    bankHolderName: bankHolderName || null,
    notes: str(fd, 'notes') || null,
    contractStatus, contractCode: str(fd, 'contractCode') || null, contractUrl: contractUrl || null,
    contractSignedAt: /^\d{4}-\d{2}-\d{2}$/.test(str(fd, 'contractSignedAt')) ? new Date(`${str(fd, 'contractSignedAt')}T00:00:00+07:00`) : null,
    status: cccd || taxCode ? 'ACTIVE' : 'PENDING_VERIFY',
  };
  const makeDefault = fd.get('isDefault') === 'on';
  const nextNo = Math.max(0, ...koc.legalProfiles.map((p) => Number(p.code.replace(/\D/g, '')) || 0)) + 1;
  await db.$transaction(async (tx) => {
    // KOC chưa có hồ sơ mà đã có CCCD / số TK đồng bộ từ Lark: lưu thành HSPL-01 trước khi thêm hồ sơ mới, không mất dữ liệu cũ.
    let no = nextNo;
    if (!id && !koc.legalProfiles.length && str(fd, 'fromLegacy') !== '1' && (koc.idNumber || koc.bankAccount)) {
      const legacyId = koc.idNumber ?? '';
      const tax = legacyId.includes('-') || [10, 13].includes(legacyId.replace(/\D/g, '').length);
      await tx.kocLegalProfile.create({
        data: {
          kocId, code: profileCode(1), legalType: 'INDIVIDUAL', isDefault: true, holderName: koc.bankHolder ?? koc.name,
          taxAccountType: DEFAULT_TAX_ACCOUNT.INDIVIDUAL, cccd: tax ? null : legacyId || null, taxCode: tax ? legacyId : null,
          bankAccount: koc.bankAccount, bankName: koc.bankName, bankHolderName: koc.bankHolder, status: legacyId && koc.bankAccount ? 'ACTIVE' : 'PENDING_VERIFY',
        },
      });
      no = 2;
    }
    if (makeDefault) await tx.kocLegalProfile.updateMany({ where: { kocId }, data: { isDefault: false } });
    if (id) await tx.kocLegalProfile.update({ where: { id, kocId }, data: { ...data, ...(makeDefault && { isDefault: true }) } });
    else await tx.kocLegalProfile.create({ data: { ...data, kocId, code: profileCode(no), isDefault: makeDefault || no === 1 } });
  });
  await mirrorDefault(kocId);
  await audit(me.id, 'Koc', kocId, id ? 'Sửa hồ sơ pháp lý' : 'Thêm hồ sơ pháp lý', { legalType, holderName });
  goBack(fd, kocId);
  return null;
}

export async function setDefaultLegalProfile(fd: FormData) {
  const me = await legalEditor();
  const p = await db.kocLegalProfile.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  await db.$transaction([
    db.kocLegalProfile.updateMany({ where: { kocId: p.kocId }, data: { isDefault: false } }),
    db.kocLegalProfile.update({ where: { id: p.id }, data: { isDefault: true } }),
  ]);
  await mirrorDefault(p.kocId);
  await audit(me.id, 'Koc', p.kocId, `Đặt ${p.code} làm hồ sơ mặc định`);
  goBack(fd, p.kocId);
}

export async function deleteLegalProfile(fd: FormData) {
  const me = await legalEditor();
  const p = await db.kocLegalProfile.findUniqueOrThrow({ where: { id: str(fd, 'id') } });
  if ((await db.kocLegalProfile.count({ where: { kocId: p.kocId } })) < 2) throw new Error('KOC phải còn ít nhất một hồ sơ pháp lý.');
  await db.kocLegalProfile.delete({ where: { id: p.id } });
  await mirrorDefault(p.kocId);
  await audit(me.id, 'Koc', p.kocId, `Xoá hồ sơ pháp lý ${p.code}`);
  goBack(fd, p.kocId);
}
