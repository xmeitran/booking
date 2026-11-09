// Nạp toàn bộ danh bạ cho màn Danh bạ KOC / KOL (lọc, đếm chip, phân trang bằng directory() trong lib/kocDirectory, như b2c).
import 'server-only';
import { cache } from 'react';
import { db } from '@/lib/db';
import { CANCELLED } from '@/lib/jobs';
import type { DirKoc, LarkInfo, LegalType } from '@/lib/kocDirectory';

const endOfToday = () => new Date(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) + 'T23:59:59+07:00');

export const loadDirectory = cache(async (): Promise<DirKoc[]> => {
  const [kocs, follow, lark] = await Promise.all([
    db.koc.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true, handle: true, name: true, nickname: true, platform: true, avatarUrl: true, channelUrl: true, phone: true, zalo: true, email: true,
        niche: true, category: true, kl: true, klAuto: true, statsAt: true, receiverName: true, address: true, blacklisted: true, tags: true,
        bookingCount: true, coopConfirmed: true, readiness: true, contactStatus: true, idNumber: true, bankAccount: true, bankHolder: true, bankName: true,
        rateCard: true, followers: true, avgViews: true, unitsSold: true, gmvRange: true, updatedAt: true, lastBookingAt: true,
        pic: { select: { name: true } },
        _count: { select: { jobs: { where: { stage: { not: CANCELLED } } } } },
        aliases: { select: { handle: true } },
        channels: { select: { platform: true, handle: true, role: true }, orderBy: { createdAt: 'asc' } },
        legalProfiles: true,
        reviews: { select: { verdict: true, brand: true, createdAt: true } },
        ratings: { select: { stars: true, tags: true } },
      },
    }),
    db.kocNote.findMany({ where: { doneAt: null, followUpAt: { lte: endOfToday() } }, distinct: ['kocId'], select: { kocId: true } }),
    larkByChannel(),
  ]);
  const due = new Set(follow.map((n) => n.kocId));
  return kocs.map(({ pic, _count, aliases, legalProfiles, ...k }) => ({
    ...k,
    picName: pic?.name ?? null,
    jobs: _count.jobs,
    aliases: aliases.map((a) => a.handle),
    saved: legalProfiles.map((p) => ({ ...p, legalType: p.legalType as LegalType })),
    lark: k.platform === 'TikTok' ? lark.get(k.handle) ?? null : null,
    followUp: due.has(k.id),
  }));
});

/** Booking trên Lark gộp theo ID kênh (khớp Koc.handle như refreshKocAggregates). */
async function larkByChannel() {
  const rows = await db.$queryRaw<(LarkInfo & { h: string })[]>`
    select h, count(*)::int n,
      count(*) filter (where cost > 0)::int paid,
      count(*) filter (where coalesce(cost, 0) = 0)::int foc,
      min(cost) filter (where cost > 0) "minCost",
      max(cost) filter (where cost > 0) "maxCost",
      (array_agg(cost order by d desc nulls last) filter (where cost > 0 and extra->>'format' ilike '%video%'))[1] "lastVideo",
      (array_agg(cost order by d desc nulls last) filter (where cost > 0))[1] "lastCost",
      count(distinct brand)::int brands,
      (array_agg(brand order by d desc nulls last) filter (where brand is not null))[1] "brand",
      (array_agg("planMonth" order by d desc nulls last) filter (where "planMonth" is not null))[1] "month",
      (array_agg(code order by d desc nulls last))[1] "code",
      (array_agg("bookingPic" order by d desc nulls last) filter (where "bookingPic" is not null))[1] "pic",
      string_agg(distinct "bookingPic", ', ') "pics",
      (array_agg(extra->>'accountType' order by d desc nulls last) filter (where coalesce(extra->>'accountType', 'null') <> 'null'))[1] "accountType"
    from (select *, lower(channel) h, coalesce("airDate", "planAirDate", "larkUpdatedAt") d from "Booking" where channel is not null) b
    group by h`;
  return new Map(rows.map(({ h, ...r }) => [h, r]));
}

/** ID kênh có booking mang mã BO chứa chuỗi tìm (ô tìm "mã BO"). */
export async function boHandles(q: string) {
  const s = q.trim();
  if (s.length < 4 || !/\d/.test(s)) return new Set<string>();
  const rows = await db.booking.findMany({ where: { code: { contains: s, mode: 'insensitive' }, channel: { not: null } }, select: { channel: true }, take: 200 });
  return new Set(rows.map((r) => r.channel!.toLowerCase()));
}
