// Parses a SimGrid race-results page (HTML) for Le Mans Ultimate championships.
//
// IMPORTANT: Qualifying and Race pages have DIFFERENT column layouts.
// Race:      Pos | Driver | Votes | Car badge | Vehicle | Laps | Best Lap | Time/Gap | Grid Δ | PP | Pts | (delta)
// Qualifying: Pos | Driver | Car badge | Vehicle | Best Lap | Sector x3 | Gap to P1 | (delta)
// (No Votes/Laps columns in Qualifying; extra sector-time columns instead.)
//
// Because of this, we deliberately avoid indexing cells by fixed position and
// instead find things semantically (by class name, by data attribute, by
// "the cell right after the last lap-time cell") so this keeps working
// regardless of which layout a given session uses.
//
// SimGrid doesn't appear to track penalty points/points in a way that's
// reliably positioned or used by this dashboard, so those aren't parsed.

import * as cheerio from "cheerio";

function parseMsFromAttr(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function textOf($el) {
  return $el.text().replace(/\s+/g, " ").trim();
}

/**
 * @param {string} html - raw HTML of one results page (one class, one session)
 * @param {object} meta - { classLabel, isRace } isRace must be passed explicitly:
 *   the leader's row looks identical in both layouts (no gap to show either
 *   way), so it can't be reliably auto-detected from the HTML alone.
 */
export function parseSimGridResultsTable(html, meta = {}) {
  const $ = cheerio.load(html);
  const rows = [];

  $('tr[id^="session_result_"]').each((_, rowEl) => {
    const $row = $(rowEl);
    const tds = $row.find("> td");
    if (tds.length < 5) return; // not a data row we recognise, skip defensively

    const positionText = textOf($(tds[0]));
    const position = parseInt(positionText, 10);
    if (!Number.isFinite(position)) return; // e.g. a header/spacer row

    const driverLink = $row.find('a[href^="/drivers/"]').first();
    const driverName = driverLink.attr("title")?.trim() || textOf(driverLink) || "Unknown driver";
    const driverProfileUrl = driverLink.attr("href") ? `https://www.thesimgrid.com${driverLink.attr("href")}` : null;

    const carNumber = textOf($row.find(".car-number").first()) || null;
    const carClassFromPage = textOf($row.find(".car-class").first()) || meta.classLabel || "Unclassified";

    const vehicle = $row.find(".manufacturer img").first().attr("title")?.trim() || null;

    // Track positions directly as we scan (rather than searching for a cell
    // afterwards via .index()) — several sector-time cells can share
    // IDENTICAL content (e.g. multiple "00.000" placeholders), and a
    // value-based lookup for "the last one" can silently match the wrong
    // (earlier) cell in that case.
    const tdsArray = tds.toArray();
    let bestLapCellEl = null;
    let lastMsCellIndex = -1;
    tdsArray.forEach((td, i) => {
      if ($(td).attr("data-milliseconds") !== undefined) {
        if (bestLapCellEl === null) bestLapCellEl = td;
        lastMsCellIndex = i;
      }
    });
    const bestLapCell = bestLapCellEl ? $(bestLapCellEl) : null;
    const bestLapMs = bestLapCell ? parseMsFromAttr(bestLapCell.attr("data-milliseconds")) : null;
    const bestLapDisplay = bestLapMs != null ? textOf(bestLapCell.find("code").first()) : null;

    // The Time/Gap (Race) or Gap-to-P1 (Qualifying) cell is the next <td>
    // sibling after the LAST data-milliseconds cell — this skips past any
    // sector-time columns automatically, whichever layout we're looking at.
    const gapCell = (lastMsCellIndex >= 0 && lastMsCellIndex + 1 < tdsArray.length)
      ? $(tdsArray[lastMsCellIndex + 1])
      : null;

    const gapCellText = gapCell ? textOf(gapCell) : "";
    const isDns = /DNS/i.test(gapCellText);
    const isDnf = /DNF/i.test(gapCellText);
    const isDsq = /DSQ/i.test(gapCellText);

    let totalTimeDisplay = null;
    let gapDisplay = null;
    if (gapCell && !isDns && !isDnf && !isDsq) {
      if (meta.isRace) {
        // Race layout: <code> holds total time; <small class="text-muted">
        // holds "+gap" or "+N Laps" (absent entirely for the leader, who has
        // no gap — that's expected, not a parsing failure).
        // Scoping to small.text-muted specifically avoids a SimGrid markup
        // quirk where the leader's cell sometimes fails to close properly,
        // nesting the NEXT cell's unrelated small.text-green (Grid Rating
        // Movement) tag inside this one.
        totalTimeDisplay = textOf(gapCell.find("code").first()).split("+")[0].trim() || null;
        gapDisplay = textOf(gapCell.find("small.text-muted").first()) || null;
      } else {
        // Qualifying layout: <code> holds the gap-to-pole directly (e.g.
        // "+00.000" for pole itself, "+01.234" for everyone else).
        gapDisplay = textOf(gapCell.find("code").first()) || gapCellText || null;
      }
    }

    // Laps only exists in the Race layout — a plain (no data-milliseconds)
    // numeric cell between the car-badge/vehicle cells and Best Lap. If we
    // can't confidently find it (e.g. Qualifying has no such column), leave
    // it null rather than guessing.
    let laps = null;
    if (bestLapCellEl) {
      const bestLapIndex = tdsArray.indexOf(bestLapCellEl);
      for (let i = bestLapIndex - 1; i >= 0; i--) {
        const t = textOf($(tdsArray[i]));
        if (/^\d+$/.test(t)) {
          laps = parseInt(t, 10);
          break;
        }
        if (t) break; // hit a non-numeric, non-empty cell first — no laps column here
      }
    }

    rows.push({
      classPosition: position,
      driver: driverName,
      driverProfileUrl,
      carNumber,
      carClass: carClassFromPage,
      vehicle,
      laps,
      bestLapMs,
      bestLap: bestLapDisplay,
      totalTimeDisplay: isDns || isDnf || isDsq ? null : totalTimeDisplay,
      gapDisplay,
      status: isDns ? "DNS" : isDnf ? "DNF" : isDsq ? "DSQ" : "FINISHED",
    });
  });

  return rows;
}
