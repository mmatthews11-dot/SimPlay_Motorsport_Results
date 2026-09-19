// Parses a SimGrid championship "Races" page to find which rounds have
// published results yet.
//
// SimGrid uses (at least) two different page templates depending on the
// championship's configuration, so this tries both and merges whatever it
// finds — that way it keeps working if a given championship uses either.
//
// Template A ("race weekend" style — e.g. multi-session events with FP/Q/R):
//   <div class="tab-pane" id="information-round{raceId}"> containing the
//   round's heading and, once results exist, a "View Results" link with
//   BOTH race_id and round_id in its href.
//
// Template B ("race card" style — e.g. solo/sprint events):
//   <button class="race-card" data-race-panel-url="/championships/{id}/races/{raceId}/panel">
//   containing a status badge ("Ended" or "Upcoming") and a
//   ".race-card-title" label. No round_id is used at all for this template —
//   results URLs for these championships only need race_id.

import * as cheerio from "cheerio";

function parseTemplateA($) {
  const races = [];
  $('div.tab-pane[id^="information-round"]').each((_, el) => {
    const $pane = $(el);
    const label = $pane.find("h4.fs-m").first().text().replace(/\s+/g, " ").trim();
    const resultsLink = $pane.find('a[href*="results?race_id="]').first().attr("href");
    if (!resultsLink) return; // round hasn't happened yet, no results link

    const url = new URL(resultsLink, "https://www.thesimgrid.com");
    const roundId = url.searchParams.get("round_id");
    const raceId = url.searchParams.get("race_id");
    if (!roundId || !raceId) return;

    races.push({ raceId, roundId, label: label || `Race ${raceId}` });
  });
  return races;
}

function parseTemplateB($) {
  const races = [];
  $('button.race-card[data-race-panel-url*="/races/"]').each((_, el) => {
    const $btn = $(el);
    const panelUrl = $btn.attr("data-race-panel-url") || "";
    const match = panelUrl.match(/\/races\/(\d+)\/panel/);
    if (!match) return;
    const raceId = match[1];

    const badgeText = $btn.text().replace(/\s+/g, " ");
    const hasEnded = /\bEnded\b/.test(badgeText);
    if (!hasEnded) return; // "Upcoming" round, skip — no results yet

    const label = $btn.find(".race-card-title").first().text().replace(/\s+/g, " ").trim();
    races.push({ raceId, roundId: null, label: label || `Race ${raceId}` });
  });
  return races;
}

export function parseRacesPage(html) {
  const $ = cheerio.load(html);
  const fromA = parseTemplateA($);
  const fromB = parseTemplateB($);

  // Merge, de-duplicating by raceId in case a page somehow matched both
  // templates (shouldn't normally happen, but safe either way).
  const seen = new Set();
  const merged = [];
  for (const race of [...fromA, ...fromB]) {
    if (seen.has(race.raceId)) continue;
    seen.add(race.raceId);
    merged.push(race);
  }
  return merged;
}
