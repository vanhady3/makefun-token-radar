// Category-level reading of the ranked board.
//
// The board ranks protocols one by one; this module steps back and asks
// what each category looks like as a whole. For every category that
// appears on the board it totals the locked value and the modelled
// implied value, names the category's strongest protocol, and takes
// the median of implied value per dollar of TVL — a median, not a
// mean, so one outsized protocol cannot set the category's tone.
//
// The narrative then picks out three things a reader wants first:
// the three categories carrying the most implied value, the single
// largest protocol on the board, and the pre-token protocol growing
// fastest over the last seven days. Everything here is derived from
// the board rows and the snapshot alone; nothing is hand-listed and
// nothing depends on the order the rows happen to arrive in, so the
// output is the same on every run over the same snapshot.

import { MODEL_VERSION, type BoardRow, type Snapshot } from './model.ts';

/** One category's totals, its strongest protocol, and its median pricing. */
export interface CategoryInsight {
  category: string;
  protocols: number;
  total_tvl_usd: number;
  total_implied_usd: number;
  top_slug: string;
  top_name: string;
  top_implied_usd: number;
  median_implied_per_tvl: number;
}

/** The board's single largest protocol, by implied value. */
export interface BiggestProtocol {
  slug: string;
  name: string;
  category: string | null;
  implied_value_usd: number;
  tvl_usd: number;
}

/** The board's fastest-growing protocol over the last seven days. */
export interface FastestProtocol {
  slug: string;
  name: string;
  category: string | null;
  change_7d: number;
  implied_value_usd: number;
}

/** The short story the numbers tell, in structured form plus one sentence. */
export interface InsightsNarrative {
  top_categories_by_implied: string[];
  largest_protocol: BiggestProtocol | null;
  fastest_growing_protocol: FastestProtocol | null;
  summary: string;
}

/** The whole insights document, written to /output/insights.json. */
export interface InsightsDoc {
  as_of: string;
  model_version: string;
  board_size: number;
  categories: CategoryInsight[];
  narrative: InsightsNarrative;
}

/** The middle value of a list, or 0 when the list is empty. */
function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  if (ordered.length % 2 === 1) return ordered[middle]!;
  return (ordered[middle - 1]! + ordered[middle]!) / 2;
}

/** A whole-dollar figure with thousands separators, e.g. 1,234,567. */
function withCommas(amount: number): string {
  return Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** One category's insight, from the rows that belong to it. */
function summariseCategory(category: string, rows: BoardRow[]): CategoryInsight {
  let tvlTotal = 0;
  let impliedTotal = 0;
  let best: BoardRow = rows[0]!;
  const ratios: number[] = [];
  for (const row of rows) {
    tvlTotal += row.tvl_usd;
    impliedTotal += row.implied_value_usd;
    if (row.implied_value_usd > best.implied_value_usd) best = row;
    ratios.push(row.tvl_usd > 0 ? row.implied_value_usd / row.tvl_usd : 0);
  }
  return {
    category,
    protocols: rows.length,
    total_tvl_usd: tvlTotal,
    total_implied_usd: impliedTotal,
    top_slug: best.slug,
    top_name: best.name,
    top_implied_usd: best.implied_value_usd,
    median_implied_per_tvl: medianOf(ratios),
  };
}

/** The insights document for a finished board. */
export function buildInsights(board: BoardRow[], snap: Snapshot): InsightsDoc {
  const buckets = new Map<string, BoardRow[]>();
  for (const row of board) {
    const key = row.category ?? 'Other';
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const categories = [...buckets.entries()].map(([category, rows]) => summariseCategory(category, rows));
  categories.sort(
    (a, b) => b.total_implied_usd - a.total_implied_usd || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
  );

  let largest: BoardRow | null = null;
  for (const row of board) {
    if (largest === null || row.implied_value_usd > largest.implied_value_usd) largest = row;
  }
  let fastest: BoardRow | null = null;
  for (const row of board) {
    if (row.change_7d === null) continue;
    const beats =
      fastest === null ||
      row.change_7d > (fastest.change_7d ?? Number.NEGATIVE_INFINITY) ||
      (row.change_7d === fastest.change_7d && row.implied_value_usd > fastest.implied_value_usd);
    if (beats) fastest = row;
  }

  const topThree = categories.slice(0, 3).map((entry) => entry.category);
  const largestText =
    largest === null
      ? 'no protocol was ranked'
      : `${largest.name} is the largest single protocol at $${withCommas(largest.implied_value_usd)} of implied value`;
  const fastestText =
    fastest === null
      ? 'no protocol reports a 7-day change'
      : `${fastest.name} is the fastest-growing pre-token protocol at ${fastest.change_7d}% over 7 days`;
  const summary =
    `Across ${board.length} ranked protocols, ` +
    `${topThree.join(', ')} carry the most implied value. ` +
    `${largestText}; ${fastestText}.`;
  return {
    as_of: snap.as_of,
    model_version: MODEL_VERSION,
    board_size: board.length,
    categories,
    narrative: {
      top_categories_by_implied: topThree,
      largest_protocol:
        largest === null
          ? null
          : {
              slug: largest.slug,
              name: largest.name,
              category: largest.category,
              implied_value_usd: largest.implied_value_usd,
              tvl_usd: largest.tvl_usd,
            },
      fastest_growing_protocol:
        fastest === null || fastest.change_7d === null
          ? null
          : {
              slug: fastest.slug,
              name: fastest.name,
              category: fastest.category,
              change_7d: fastest.change_7d,
              implied_value_usd: fastest.implied_value_usd,
            },
      summary,
    },
  };
}
