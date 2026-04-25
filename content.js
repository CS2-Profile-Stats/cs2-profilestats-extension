const API_URL = "http://localhost:8080";

// cache for 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

async function cachedFetch(key, fetchFn) {
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];

  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data;
  }

  const data = await fetchFn();
  // errors shouldn't be cached
  if (data && !data.error) {
    await chrome.storage.local.set({
      [key]: { data, timestamp: Date.now() }
    });
  }
  return data;
}

function backgroundFetch(url, html = false) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: html ? "fetchHtml" : "fetch", url }, resolve);
  });
}

async function fetchCSStatsProfile(steamId64) {
  return cachedFetch(`csstats:${steamId64}`, async () => {
    const parser = new DOMParser();

    const [profileHTML, statsHTML] = await Promise.all([
      backgroundFetch(`https://csstats.gg/player/${steamId64}`, true),
      backgroundFetch(`https://csstats.gg/player/${steamId64}/stats`, true),
    ]);

    if (!profileHTML) return null;

    const profile = parser.parseFromString(profileHTML, "text/html");

    if (profile.querySelector("#outer-wrapper h1")?.textContent.trim() === "Private Profile") return { error: "private" };

    if (!statsHTML) return null;

    const stats = parser.parseFromString(statsHTML, "text/html");
    if (!stats.querySelector(".content-sub-nav-outer")) return { error: "not found" };

    const name = profile.querySelector("#player-name")?.textContent?.trim()

    const kdRatio = parseFloat(stats.querySelector("#kpd span")?.textContent?.trim())
    const hltvRating = parseFloat(stats.querySelector("#rating span")?.textContent?.trim())
    const mostPlayedMap = stats.querySelector("#player-maps canvas")?.id.replace("-wr-chart-canvas", "");

    const statPanels = stats.querySelectorAll(".stat-panel");

    let winRate = null;
    let matches = null;
    let hsPercentage = null;
    let adr = null;
    let clutch = null

    const getPanelValue = (panel) => {
      const text = panel.querySelector("[style*='font-size:34px']")?.childNodes[0].textContent.trim();
      return text ? parseInt(text) : null;
    };

    statPanels.forEach(panel => {
      const heading = panel.querySelector(".stat-heading")?.textContent.trim();
      if (!heading) return;

      if (heading === "Win Rate") {
        winRate = getPanelValue(panel);
        matches = parseInt(panel.querySelector(".total-value")?.textContent.trim());
      } else if (heading.includes("HS") && hsPercentage === null) {
        hsPercentage = getPanelValue(panel);
      } else if (heading.includes("ADR")) {
        adr = getPanelValue(panel);
      } else if (heading.includes("Clutch")) {
        clutch = getPanelValue(panel);
      }
    });

    const getRating = (el) => {
      const span = el.querySelector(".cs2rating span");
      if (!span) return null;
      const main = span.childNodes[0].textContent.trim();
      if (main === "---") return 0;
      const decimal = span.querySelector("small")?.textContent.trim().replace(",", "") ?? "";
      return parseInt(main + decimal);
    };

    const premierRatings = [];
    const competitiveRanks = [];
    let wingman = null;

    profile.querySelectorAll("#player-ranks .ranks").forEach(rankDiv => {
      const icon = rankDiv.querySelector(".icon");
      if (!icon) return;

      const img = icon.querySelector("img");
      const alt = img?.getAttribute("alt") ?? "";
      const wins = parseInt(rankDiv.querySelector(".bottom .wins b")?.textContent.trim()) || 0;
      const rankSrc = rankDiv.querySelector(".rank img")?.getAttribute("src");
      const bestSrc = rankDiv.querySelector(".best img")?.getAttribute("src");

      if (alt.startsWith("Premier")) {
        const seasonMatch = alt.match(/Season (\d+)/);
        premierRatings.push({
          season: seasonMatch ? parseInt(seasonMatch[1]) : 1,
          latest_rating: getRating(rankDiv.querySelector(".rank")),
          best_rating: getRating(rankDiv.querySelector(".best")),
          wins,
        });
        return;
      }

      if (alt === "FACEIT") return;

      if (alt === "Wingman") {
        const rankMatch = rankSrc?.match(/wingman(\d+)\.svg/);
        const bestMatch = bestSrc?.match(/wingman(\d+)\.svg/);
        wingman = rankMatch ? {
          latest_rank: parseInt(rankMatch[1]),
          best_rank: bestMatch ? parseInt(bestMatch[1]) : null,
          wins
        } : null;
        return;
      }

      const mapName = img ? alt : icon.textContent.trim();
      const rankMatch = rankSrc?.match(/\/ranks\/(\d+)\.png/);
      const bestMatch = bestSrc?.match(/\/ranks\/(\d+)\.png/);
      if (mapName && rankMatch) {
        competitiveRanks.push({
          map: mapName,
          latest_rank: parseInt(rankMatch[1]),
          best_rank: bestMatch ? parseInt(bestMatch[1]) : null,
          wins,
        });
      }
    });

    // recent results
    const dots = [...stats.querySelectorAll(".match-dot-outer .match-dot")].reverse().slice(0, 5);
    const recentResults = dots.map(dot => {
      if (dot.classList.contains("match-win")) return "W";
      if (dot.classList.contains("match-lose")) return "L";
      if (dot.classList.contains("match-draw")) return "T";
      return null;
    }).filter(Boolean);

    return {
      name: name,
      stats: {
        premier_ratings: premierRatings,
        kd_ratio: kdRatio,
        hltv_rating: hltvRating,
        matches: matches,
        win_rate: winRate,
        hs_percentage: hsPercentage,
        adr: adr,
        clutch: clutch,
        recent_results: recentResults,
        most_played_map: mostPlayedMap,
        competitive_ranks: competitiveRanks,
        wingman: wingman,
      },
    };
  });
}

async function resolveVanity(vanity) {
  return cachedFetch(`steamid:${vanity}`, async () => {
    const data = await backgroundFetch(`${API_URL}/api/resolveVanity/${vanity}`);
    return data?.steam_id ?? null;
  });
}

async function fetchCS2Locker(steamId64) {
  return cachedFetch(`cs2locker:${steamId64}`, () =>
    backgroundFetch(`https://cs2locker.com/api/quotes/embed?steamId=${steamId64}&ref=cs2-profile-stats&slim=true`)
  );
}

async function fetchFaceitProfile(steamId64) {
  return cachedFetch(`faceitcs2:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/faceit/${steamId64}?game=cs2`)
  );
}

async function fetchFaceitCsgoProfile(steamId64) {
  return cachedFetch(`faceitcsgo:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/faceit/${steamId64}?game=csgo`)
  );
}

async function fetchLeetifyProfile(steamId64) {
  return cachedFetch(`leetify:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/leetify/${steamId64}`)
  );
}

async function fetchSteamProfile(steamId64) {
  return cachedFetch(`steam:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/steam/${steamId64}`)
  );
}

function getTimeDiff(dateStr, mode = "ago") {
  const now = new Date();
  const date = new Date(dateStr);
  const from = mode === "until" ? now : date;
  const to = mode === "until" ? date : now;
  let years = to.getFullYear() - from.getFullYear();
  let months = to.getMonth() - from.getMonth();
  if (months < 0) { years--; months += 12; }
  return { years, months };
}

function formatDate({ years, months }) {
  const parts = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  return parts.length > 0 ? parts.join(", ") : "< 1m";
}

function formatLastMatchDate(dateStr) {
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(new Date(dateStr));
}

const PREMIER_RANKS = [
  { starts: 0, color: "#c4cce2", name: "grey" },
  { starts: 5000, color: "#8cc6ff", name: "lightblue" },
  { starts: 10000, color: "#6a7dff", name: "blue" },
  { starts: 15000, color: "#c166ff", name: "purple" },
  { starts: 20000, color: "#f03cff", name: "pink" },
  { starts: 25000, color: "#eb4b4b", name: "red" },
  { starts: 30000, color: "#ffd700", name: "gold" },
]

function getPremierRank(rating) { return PREMIER_RANKS.findLast(t => rating >= t.starts); }
function getPremierColor(rating) { return getPremierRank(rating).color }
function getPremierColorName(rating) { return getPremierRank(rating).name }
function getPremierBg(rating) { return chrome.runtime.getURL(`assets/premier_ratings/${getPremierRank(rating).name}.svg`) }

function getPremierCoinProgress(wins) {
  if (wins < 25) return ""
  if (wins < 50) return "1"
  if (wins < 75) return "2"
  if (wins < 100) return "3"
  if (wins < 125) return "4"
  return "5"
}

function getPremierCoin(rating, season, wins) {
  if (wins < 25) return `${API_URL}/assets/premier_coins/${season}.png`
  if (season === 1) return `${API_URL}/assets/premier_coins/1.png`
  const color = getPremierColorName(rating)
  const progress = getPremierCoinProgress(wins)
  return `${API_URL}/assets/premier_coins/${season}_${color}_${progress}.png`
}

function getFaceitColor(level) {
  if (level === 1) return "#dddddd";
  if (level === 2 || level === 3) return "#47e66e";
  if (level >= 4 && level <= 7) return "#fecd23";
  if (level === 8 || level === 9) return "#fd6c1e";
  if (level === 10) return "#e80026";
  return "#dddddd";
}

function getFaceitLevelImage(level, ranking) {
  if (ranking >= 1000 || ranking === 0) {
    return chrome.runtime.getURL(`assets/faceit_levels/${level}.png`);
  } else {
    return chrome.runtime.getURL("assets/faceit_levels/challenger.png")
  }
}

async function getSteamId(url) {
  if (url.includes("/id/")) {
    const vanity = url.match(/\/id\/([^\/]+)/)[1];
    const steamId64 = await resolveVanity(vanity);
    if (!steamId64 || typeof steamId64 !== "string") {
      return null;
    }
    return steamId64;
  }

  const match = url.match(/profiles\/(765\d+)/);
  return match ? match[1] : null;
}

function createLockerSkin(skin, currency) {
  const container = document.createElement("div")
  container.classList.add("profilestats-cs2locker_skin")

  const inner = document.createElement("div")
  inner.classList.add("profilestats-cs2locker_skin_inner")

  const innerImgContainer = document.createElement("a")
  innerImgContainer.href = skin.inspectLink
  innerImgContainer.target = "_blank"

  const innerImg = document.createElement("img")
  innerImg.classList.add("profilestats-cs2locker_skin_image")
  innerImg.src = skin.iconUrl
  innerImgContainer.appendChild(innerImg)

  inner.appendChild(innerImgContainer)

  const priceTag = document.createElement("span")
  priceTag.classList.add("profilestats-cs2locker_skin_pricetag")
  priceTag.textContent = skin.price + currency
  inner.appendChild(priceTag)

  const info = document.createElement("div")
  info.classList.add("profilestats-cs2locker_skin_info")

  if (skin.stickers?.length > 0) {
    const stickers = document.createElement("div")
    stickers.classList.add("profilestats-cs2locker_stickers")
    skin.stickers.forEach(sticker => {
      const stickerContainer = document.createElement("a")
      stickerContainer.classList.add("profilestats-cs2locker_sticker")
      const stickerName = sticker.name.replace("Sticker: ", "Sticker | ")
      stickerContainer.href = "https://steamcommunity.com/market/listings/730/" + stickerName
      stickerContainer.title = stickerName
      stickerContainer.target = "_blank"

      const stickerImg = document.createElement("img")
      stickerImg.classList.add("profilestats-cs2locker_sticker_image")
      stickerImg.src = sticker.imageUrl
      stickerContainer.appendChild(stickerImg)

      stickers.appendChild(stickerContainer)
    })
    info.appendChild(stickers)
  }
  if (skin.floatValue != null) {
    const floatEl = document.createElement("span")
    floatEl.classList.add("profilestats-cs2locker_skin_fv")
    floatEl.title = String(skin.floatValue)
    const truncFloat = skin.floatValue.toFixed(7)
    floatEl.textContent = truncFloat
    info.appendChild(floatEl)
  }

  const nameEl = document.createElement("a")
  nameEl.classList.add("profilestats-cs2locker_skin_name")
  nameEl.href = "https://steamcommunity.com/market/listings/730/" + skin.name
  nameEl.target = "_blank"
  nameEl.textContent = skin.name
  nameEl.title = skin.name
  nameEl.style.color = skin.rarityColor
  info.appendChild(nameEl)

  container.appendChild(inner)
  container.appendChild(info)

  return container
}

function createTemplate(logos, uiIcons) {
  const { steamLogo, leetifyLogo, leetifyBadge, csstatsLogo, faceitLogo, cs2lockerLogo, cs2lockerBadge, csrepLogo, steamidLogo, csfloatLogo, steamhistoryLogo } = logos;
  const { settings, chevronUp, chevronDown } = uiIcons;

  const template = document.createElement("template");
  template.innerHTML = `
    <div class="profile_customization">
      <div class="profile_customization_header profilestats-customization_header">
        <div id="profilestats-customization_header_start">
        CS2 Profile Stats
        <div data-screenshot="hidden" class="profilestats-links">
          <a id="profilestats-links_csrep" target="_blank" title="CSRep.gg"><img src="${csrepLogo}"/></a>
          <a id="profilestats-links_steamid" target="_blank" title="SteamID.io"><img src="${steamidLogo}"/></a>
          <a id="profilestats-links_steamhistory" target="_blank" title="SteamHistory"><img src="${steamhistoryLogo}"/></a>
          <a id="profilestats-links_csfloat" target="_blank" title="CSFloat Stall"><img src="${csfloatLogo}"/></a>
        </div>
        </div>
        <div data-screenshot="hidden" id="profilestats-customization_header_end">
          <button class="profilestats-settings_button"><img src="${settings}"/></button>
          <button class="profilestats-collapse_button">▲</button>
        </div>
      </div>
      <div class="profile_customization_block">
        <div class="showcase_content_bg profilestats-steam">
          <div class="profilestats-header">
            <div class="profilestats-header_start">
              <a class="profilestats-category_logo" id="profilestats-steam_category_logo" target="_blank">
                <img src="${steamLogo}"/>
              </a>
              <div id="profilestats-steam_profile">
                <div id="profilestats-steam_profile_header">
                  <div><span id="profilestats-steam_name"></span></div>
                  <span id="profilestats-steam_steamid64"></span>
                  <div class="profilestats-ban" id="profilestats-steam_ban" style="display: none"><span class="profilestats-separator">|</span><span class="profilestats-ban_reason">Community banned</span></div>
                </div>
              </div>
            </div>
            <div class="profilestats-header_end">
              <div class="profilestats-updown" id="profilestats-steam_updown" style="display: none">
                <button class="profilestats-updown_button profilestats-updown_button_up">
                  <img src="${chevronUp}"/>
                </button>
                <button class="profilestats-updown_button profilestats-updown_button_down">
                  <img src="${chevronDown}"/>
                </button>
              </div>
            </div>
          </div>
          <div id="profilestats-steam_content">
            <div id="profilestats-steam_details">
              <div>Created: <span id="profilestats-steam_registered"></span></div>
              <div>CS2 Playtime: <span id="profilestats-steam_cs2_playtime"></span></div>
            </div>
          </div>
        </div>
        <div class="showcase_content_bg profilestats-leetify">
          <div class="profilestats-header">
            <div class="profilestats-header_start">
              <a class="profilestats-category_logo" id="profilestats-leetify_category_logo" target="_blank">
                <img src="${leetifyLogo}"/>
              </a>
              <div id="profilestats-leetify_profile">
                <div id="profilestats-leetify_profile_header">
                  <div id="profilestats-leetify_premier_rating">

                  </div>
                  <div><span id="profilestats-leetify_name"></span></div>
                </div>
              </div>
              <button data-screenshot="hidden" class="profilestats-show_button" id="profilestats-leetify_show_button" style="display: none">Show all ranks</button>
            </div>
            <div class="profilestats-header_end">
              <a id="profilestats-leetify_badge" href="https://leetify.com/" target="_blank">
                <img src="${leetifyBadge}"/>
              </a>
              <div class="profilestats-updown" id="profilestats-leetify_updown" style="display: none">
                <button class="profilestats-updown_button profilestats-updown_button_up">
                  <img src="${chevronUp}"/>
                </button>
                <button class="profilestats-updown_button profilestats-updown_button_down">
                  <img src="${chevronDown}"/>
                </button>
              </div>
            </div>
          </div>
          <div id="profilestats-leetify_content">
            <div class="profilestats-details">
              <div>K/D Ratio<span id="profilestats-leetify_kd_ratio"></span></div>
              <div data-compact="hidden">Rating<span id="profilestats-leetify_leetify_rating"></span></div>
              <div>Matches<span id="profilestats-leetify_matches"></span></div>
              <div data-compact="hidden">First match<span id="profilestats-leetify_first_match"></span></div>
              <div>Winrate<span id="profilestats-leetify_win_rate"></span></div>
              <div>Aim<span id="profilestats-leetify_aim_rating"></span></div>
              <div data-compact="hidden">Positioning<span id="profilestats-leetify_positioning"></span></div>
              <div data-compact="hidden">Utility<span id="profilestats-leetify_utility"></span></div>
              <div data-compact="hidden">Clutching<span id="profilestats-leetify_clutching"></span></div>
              <div data-compact="hidden">Opening<span id="profilestats-leetify_opening"></span></div>
              <div>Preaim&#176;<span id="profilestats-leetify_preaim_angle"></span></div>
              <div>Reaction<span id="profilestats-leetify_reaction_time"></span></div>
            </div>
            <div class="profilestats-ranks" id="profilestats-leetify-ranks" style="display: none">

            </div>
          </div>
        </div>
        <div class="showcase_content_bg profilestats-csstats">
          <div class="profilestats-header">
            <div class="profilestats-header_start">
              <a class="profilestats-category_logo" id="profilestats-csstats_category_logo" target="_blank">
                <img src="${csstatsLogo}"/>
              </a>
              <div id="profilestats-csstats_profile" style="display: none">
                <div id="profilestats-csstats_profile_header">
                  <div class="profilestats-csstart_premier_container" id="profilestats-csstart_premier_container_current">
                    <span class="profilestats-csstats_premier_label">Current:</span>
                    <div id="profilestats-csstats_premier_rating_current">

                    </div>
                    <span id="profilestats-csstats_premier_indicator"></span>
                  </div>
                  <div class="profilestats-csstart_premier_container" id="profilestats-csstart_premier_container_best">
                    <span class="profilestats-csstats_premier_label">Best:</span>
                    <div id="profilestats-csstats_premier_rating_best">

                    </div>
                  </div>
                </div>
              </div>
              <button data-screenshot="hidden" class="profilestats-show_button" id="profilestats-csstats_show_button" style="display: none">Show all ranks</button>
            </div>
            <div class="profilestats-header_end">
              <div class="profilestats-updown" id="profilestats-csstats_updown" style="display: none">
                <button class="profilestats-updown_button profilestats-updown_button_up">
                  <img src="${chevronUp}"/>
                </button>
                <button class="profilestats-updown_button profilestats-updown_button_down">
                  <img src="${chevronDown}"/>
                </button>
              </div>
            </div>
          </div>
          <div id="profilestats-csstats_content">
            <div class="profilestats-details">
              <div>K/D Ratio<span id="profilestats-csstats_kd_ratio"></span></div>
              <div data-compact="hidden">HLTV Rating<span id="profilestats-csstats_hltv"></span></div>
              <div>Matches<span id="profilestats-csstats_matches"></span></div>
              <div>Winrate<span id="profilestats-csstats_win_rate"></span></div>
              <div>HS%<span id="profilestats-csstats_hs_percentage"></span></div>
              <div data-compact="hidden">ADR<span id="profilestats-csstats_adr"></span></div>
              <div data-compact="hidden">Clutch chance<span id="profilestats-csstats_clutching"></span></div>
              <div data-compact="hidden">Most played<span id="profilestats-csstats_most_played"></span></div>
            </div>
            <div class="profilestats-ranks" id="profilestats-csstats-ranks" style="display: none">

            </div>
          </div>
        </div>
        <div class="showcase_content_bg profilestats-faceit">
          <div class="profilestats-header">
            <div class="profilestats-header_start">
              <a class="profilestats-category_logo" id="profilestats-faceit_category_logo" target="_blank">
                <img src="${faceitLogo}"/>
              </a>
              <div id="profilestats-faceit_profile" style="display: none">
                <div id="profilestats-faceit_profile_header">
                  <div id="profilestats-faceit_level">

                  </div>
                  <div id="profilestats-faceit_name_col">
                    <div id="profilestats-faceit_name">
                      <img id="profilestats-faceit_flag"/>
                      <span id="profilestats-faceit_nickname"></span>
                      <span id="profilestats-faceit_registered"></span>
                      <span class="profilestats-separator"> | </span>
                      <span id="profilestats-faceit_membership"></span>
                    </div>
                    <div class="profilestats-ban" id="profilestats-faceit_ban" style="display: none">
                      <span class="profilestats-ban_reason" id="profilestats-faceit_ban_reason"></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="profilestats-header_end">
              <div class="profilestats-tabs">
                <button class="profilestats-tab active-tab" data-game="cs2">CS2</button>
                <button class="profilestats-tab" data-game="csgo">CS:GO</button>
              </div>
              <div class="profilestats-updown" id="profilestats-faceit_updown" style="display: none">
                <button class="profilestats-updown_button profilestats-updown_button_up">
                  <img src="${chevronUp}"/>
                </button>
                <button class="profilestats-updown_button profilestats-updown_button_down">
                  <img src="${chevronDown}"/>
                </button>
              </div>
            </div>
          </div>
          <div id="profilestats-faceit_content">
            <div class="profilestats-details">
              <div>Elo<span id="profilestats-faceit_elo"></span></div>
              <div>Matches<span id="profilestats-faceit_matches"></span></div>
              <div>K/D Ratio<span id="profilestats-faceit_kd_ratio"></span></div>
              <div>HS%<span id="profilestats-faceit_hs_percentage"></span></div>
              <div>Winrate<span id="profilestats-faceit_win_rate"></span></div>
              <div data-compact="hidden">Recent<span id="profilestats-faceit_recent_results"></span></div>
              <div data-compact="hidden">AVG K/D/A<span id="profilestats-faceit_avg_kda"></span></div>
              <div>Last match<span id="profilestats-faceit_last_match"></span></div>
            </div>
          </div>
        </div>
        <div class="showcase_content_bg profilestats-cs2locker">
          <div class="profilestats-header">
            <div class="profilestats-header_start">
              <a class="profilestats-category_logo" id="profilestats-cs2locker_category_logo" target="_blank">
                <img src="${cs2lockerLogo}"/>
              </a>
              <div id="profilestats-cs2locker_profile">
                <div id="profilestats-cs2locker_profile_header">
                  <div id="profilestats-cs2locker_value">Inventory value: <span id="profilestats-cs2locker_value_number"></span></div>
                </div>
              </div>
            </div>
            <div class="profilestats-header_end">
              <a id="profilestats-cs2locker_badge" href="https://cs2locker.com/" target="_blank">
                <span>Powered by</span>
                <img src="${cs2lockerBadge}"/>
              </a>
              <div class="profilestats-updown" id="profilestats-cs2locker_updown" style="display: none">
                <button class="profilestats-updown_button profilestats-updown_button_up">
                  <img src="${chevronUp}"/>
                </button>
                <button class="profilestats-updown_button profilestats-updown_button_down">
                  <img src="${chevronDown}"/>
                </button>
              </div>
            </div>
          </div>
          <div id="profilestats-cs2locker_content">
            <button data-screenshot="hidden" class="profilestats-show_button" id="profilestats-cs2locker_show_button" style="display: none">Show best skins</button>
            <div id="profilestats-cs2locker_details" style="display: none">

            </div>
          </div>
        </div>
        <div data-screenshot="hidden" class="showcase_content_bg profilestats-settings" style="display: none">
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-show_steam">Show Steam</label>
            <input type="checkbox" id="profilestats-checkbox-show_steam" checked>
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-show_leetify">Show Leetify</label>
            <input type="checkbox" id="profilestats-checkbox-show_leetify" checked>
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-show_csstats">Show CSStats</label>
            <input type="checkbox" id="profilestats-checkbox-show_csstats" checked>
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-show_faceit">Show Faceit</label>
            <input type="checkbox" id="profilestats-checkbox-show_faceit" checked>
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-show_cs2locker">Show CS2Locker</label>
            <input type="checkbox" id="profilestats-checkbox-show_cs2locker">
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-collapsed">Start collapsed</label>
            <input type="checkbox" id="profilestats-checkbox-collapsed">
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-compact">Compact mode</label>
            <input type="checkbox" id="profilestats-checkbox-compact">
          </div>
          <div class="profilestats-checkbox">
            <label for="profilestats-checkbox-failed">Hide failed</label>
            <input type="checkbox" id="profilestats-checkbox-failed">
          </div>
          <div class="profilestats-button">
            <button id="profilestats-button-screenshot">Enable screenshot mode</button>
          </div>
          <div class="profilestats-button">
            <button id="profilestats-button-edit">Toggle edit order</button>
          </div>
        </div>
      </div>
    </div>
  `;

  return template.content.cloneNode(true);
}

const formatPremierRating = (rating) => {
  return rating === 0 ? "---" : new Intl.NumberFormat("en-US").format(rating)
}

function createRanksSection(sectionLabel, headers, gridClass) {
  const container = document.createElement("div")
  container.classList.add("profilestats-ranks-section")

  const label = document.createElement("span")
  label.classList.add("profilestats-ranks-section-label")
  label.textContent = sectionLabel
  container.appendChild(label)

  const grid = document.createElement("div")
  grid.classList.add(gridClass)
  container.appendChild(grid)

  headers.forEach(headerText => {
    const header = document.createElement("span")
    header.classList.add("profilestats-ranks-header")
    header.textContent = headerText
    grid.appendChild(header)
  })

  return { container, grid }
}

function createRankLeft(asset, text1, text2) {
  const container = document.createElement("div")
  container.classList.add("profilestats-rank_left")

  const img = document.createElement("img")
  img.src = asset
  container.appendChild(img)

  const texts = document.createElement("div")
  texts.classList.add("profilestats-rank_left_text")

  const topText = document.createElement("span")
  topText.classList.add("profilestats-rank_left_top_text")
  topText.textContent = text1
  texts.appendChild(topText)

  if (text2) {
    const bottomText = document.createElement("span")
    bottomText.classList.add("profilestats-rank_left_bottom_text")
    bottomText.textContent = text2
    texts.appendChild(bottomText)
  }

  container.appendChild(texts)

  return container
}

function createCompRank(mode, rank) {
  const container = document.createElement("div")
  container.classList.add("profilestats-rank-icon")

  const img = document.createElement("img")
  if (mode === "competitive") {
    img.src = chrome.runtime.getURL(`assets/ranks/competitive/${rank}.svg`)
  } else if (mode === "wingman") {
    img.src = chrome.runtime.getURL(`assets/ranks/wingman/${rank}.svg`)
  }
  container.appendChild(img)

  return container
}

function createPremierRating(rating) {
  const container = document.createElement("div")
  container.classList.add("profilestats-premier-rating")

  const bg = document.createElement("img")
  bg.src = getPremierBg(rating)
  container.appendChild(bg)

  const label = document.createElement("span")
  label.style.color = getPremierColor(rating)
  label.textContent = formatPremierRating(rating)
  container.appendChild(label)

  return container
}

function appendCompRow(grid, rank, showBest = true) {
  grid.appendChild(createRankLeft(
    `${API_URL}/assets/map_icons/${rank.map}.svg`,
    rank.map,
    `Wins: ${rank.wins}`
  ))
  grid.appendChild(createCompRank("competitive", rank.latest_rank))
  if (showBest) grid.appendChild(createCompRank("competitive", rank.best_rank))
}

function appendPremierRow(grid, rating) {
  grid.appendChild(createRankLeft(
    getPremierCoin(rating.best_rating, rating.season, rating.wins),
    `Season ${rating.season}`,
    `Wins: ${rating.wins}`
  ))
  grid.appendChild(createPremierRating(rating.latest_rating))
  grid.appendChild(createPremierRating(rating.best_rating))
}

function appendWingmanRow(grid, wingman, showBest = true) {
  grid.appendChild(createRankLeft(
    chrome.runtime.getURL("assets/modes/wingman.svg"),
    "Wingman",
    showBest ? `Wins: ${wingman.wins}` : null
  ))
  grid.appendChild(createCompRank("wingman", wingman.latest_rank))
  if (showBest) grid.appendChild(createCompRank("wingman", wingman.best_rank))
}

function fillLinks(clone, steamId64) {
  clone.querySelector("#profilestats-links_csrep").href = `https://csteamcommunity.com/profiles/${steamId64}`
  clone.querySelector("#profilestats-links_steamid").href = `https://steamid.io/lookup/${steamId64}`
  clone.querySelector("#profilestats-links_steamhistory").href = `https://steamhistory.net/id/${steamId64}`
  clone.querySelector("#profilestats-links_csfloat").href = `https://csfloat.com/stall/${steamId64}`

  clone.querySelector("#profilestats-steam_category_logo").href = `https://steamcommunity.com/profiles/${steamId64}`;
  clone.querySelector("#profilestats-leetify_category_logo").href = `https://leetify.com/app/profile/${steamId64}`;
  clone.querySelector("#profilestats-csstats_category_logo").href = `https://csstats.gg/player/${steamId64}`;
  clone.querySelector("#profilestats-cs2locker_category_logo").href = `https://cs2locker.com/inventory-value?steamId=${steamId64}&utm_source=cs2-profile-stats`;
}

function fillSteam(clone, steamData, steamId64, isGamesPrivate) {
  if (!steamData || steamData.error) {
    clone.querySelector("#profilestats-steam_content").textContent = "Couldn't load Steam data.";
    clone.querySelector(".profilestats-steam").dataset.failed = "true"
    return;
  }

  clone.querySelector("#profilestats-steam_name").textContent = steamData.name

  const steamIdEl = clone.querySelector("#profilestats-steam_steamid64")
  steamIdEl.textContent = `(${steamId64})`;
  steamIdEl.title = "Click to copy"
  steamIdEl.addEventListener("click", () => {
    navigator.clipboard.writeText(steamId64);
    steamIdEl.textContent = "(Copied!)"
    setTimeout(() => {
      steamIdEl.textContent = `(${steamId64})`;
    }, 1000)
  })

  const banEl = clone.querySelector("#profilestats-steam_ban");
  if (steamData.community_banned) {
    banEl.style.display = "";
  } else {
    banEl.style.display = "none";
  }

  const registered = steamData.registered
  if (registered != null) {
    clone.querySelector("#profilestats-steam_registered").textContent = `${formatDate(getTimeDiff(registered))} ago`;
  } else {
    clone.querySelector("#profilestats-steam_registered").textContent = "-";
  }


  const playtime = steamData.cs2_playtime;
  const playtime2Weeks = steamData.cs2_playtime_2weeks
  const playtimeEl = clone.querySelector("#profilestats-steam_cs2_playtime")

  if (playtime != null && playtime > 0) {
    const formattedPlaytime = new Intl.NumberFormat("en-US").format(playtime);
    const formattedPlaytime2Weeks = new Intl.NumberFormat("en-US").format(playtime2Weeks);
    playtimeEl.textContent = `${formattedPlaytime}h (${formattedPlaytime2Weeks}h past 2 weeks)`;
  } else {
    playtimeEl.textContent = `${isGamesPrivate || playtime == null ? "Private" : "-"}`;
  }
}

function fillLeetify(clone, leetifyData) {
  if (!leetifyData || leetifyData.error) {
    const message = leetifyData?.status === 404 ? "Leetify profile not found." : "Couldn't load Leetify data."
    clone.querySelector("#profilestats-leetify_content").textContent = message;
    clone.querySelector("#profilestats-leetify_profile").style.display = "none";
    clone.querySelector(".profilestats-leetify").dataset.failed = "true"
    return;
  }

  clone.querySelector("#profilestats-leetify_show_button").style.display = ""

  const showBtn = clone.querySelector("#profilestats-leetify_show_button");
  const ranksEl = clone.querySelector("#profilestats-leetify-ranks");

  showBtn.addEventListener("click", () => {
    const isVisible = ranksEl.style.display !== "none";
    ranksEl.style.display = isVisible ? "none" : "";
    showBtn.textContent = isVisible ? "Show all ranks" : "Hide all ranks";
  });

  const stats = leetifyData.stats;

  clone.querySelector("#profilestats-leetify_kd_ratio").textContent = `${stats.kd_ratio ?? "-"}`

  const premierRating = stats.premier_rating;

  clone.querySelector("#profilestats-leetify_premier_rating").appendChild(createPremierRating(premierRating ?? 0))

  clone.querySelector("#profilestats-leetify_name").textContent = `${leetifyData.name ?? "-"}`;
  clone.querySelector("#profilestats-leetify_matches").textContent = `${stats.matches ?? "-"}`;

  const rating = stats.leetify_rating ?? "-"
  clone.querySelector("#profilestats-leetify_leetify_rating").textContent = rating

  const firstMatch = stats.first_match
  const formattedFirstMatch = `${firstMatch != null ? formatDate(getTimeDiff(firstMatch)) : "-"} ago`
  clone.querySelector("#profilestats-leetify_first_match").textContent = formattedFirstMatch;

  const winRate = stats.win_rate
  clone.querySelector("#profilestats-leetify_win_rate").textContent = winRate != null ? `${winRate}%` : "-";
  clone.querySelector("#profilestats-leetify_aim_rating").textContent = `${stats.aim_rating ?? "-"}`;
  clone.querySelector("#profilestats-leetify_positioning").textContent = `${stats.positioning ?? "-"}`;
  clone.querySelector("#profilestats-leetify_utility").textContent = `${stats.utility ?? "-"}`;

  const clutching = stats.clutching;
  clone.querySelector("#profilestats-leetify_clutching").textContent = clutching != null ? (clutching > 0 ? `+${clutching}` : clutching) : "-";

  const opening = stats.opening;
  clone.querySelector("#profilestats-leetify_opening").textContent = opening != null ? (opening > 0 ? `+${opening}` : opening) : "-";

  const preaim = stats.preaim_angle;
  const reaction = stats.reaction_time;
  clone.querySelector("#profilestats-leetify_preaim_angle").textContent = preaim != null ? `${preaim}°` : "-";
  clone.querySelector("#profilestats-leetify_reaction_time").textContent = reaction != null ? `${reaction}ms` : "-";

  const compRanks = stats.competitive_ranks ?? [];
  const wingmanRank = stats.wingman_rank

  ranksEl.innerHTML = ""

  if (compRanks.length > 0) {
    const left = document.createElement("div")
    left.classList.add("profilestats-ranks-left")
    const { container, grid } = createRanksSection("Competitive", ["Map", "Rank"], "profilestats-leetify-ranks-competitive")
    compRanks.forEach(rank => {
      grid.appendChild(createRankLeft(`${API_URL}/assets/map_icons/${rank.map}.svg`, rank.map, null))
      grid.appendChild(createCompRank("competitive", rank.rank))
    })
    left.appendChild(container)
    ranksEl.appendChild(left)

    if (wingmanRank != null) {
      const right = document.createElement("div")
      right.classList.add("profilestats-ranks-right")
      const { container, grid } = createRanksSection("Wingman", ["Mode", "Rank"], "profilestats-leetify-wingman_rank")
      appendWingmanRow(grid, { latest_rank: wingmanRank, wins: null }, false)
      right.appendChild(container)
      ranksEl.appendChild(right)
    }
  }
}

function fillCSStats(clone, csStatsData) {
  if (!csStatsData || csStatsData.error) {
    let displayMessage = ""
    if (csStatsData?.error === "not found") {
      displayMessage = "Profile not found.";
    } else if (csStatsData?.error === "private") {
      displayMessage = "Profile is private.";
    } else {
      displayMessage = "Couldn't load CSStats data.";
    }
    clone.querySelector("#profilestats-csstats_content").textContent = displayMessage;
    clone.querySelector(".profilestats-csstats").dataset.failed = "true"
    return
  }

  clone.querySelector("#profilestats-csstats_profile").style.display = ""
  clone.querySelector("#profilestats-csstats_show_button").style.display = ""

  const ranksEl = clone.querySelector("#profilestats-csstats-ranks");
  const showBtn = clone.querySelector("#profilestats-csstats_show_button");

  showBtn.addEventListener("click", () => {
    const isVisible = ranksEl.style.display !== "none";
    ranksEl.style.display = isVisible ? "none" : "";
    showBtn.textContent = isVisible ? "Show all ranks" : "Hide all ranks";
  });

  const stats = csStatsData.stats;
  const latestPremier = stats.premier_ratings?.[0];
  const currentRating = latestPremier?.latest_rating ?? 0

  clone.querySelector("#profilestats-csstats_premier_rating_current").appendChild(createPremierRating(currentRating))

  const bestRating = stats.premier_ratings?.reduce((best, r) => Math.max(best, r.best_rating), 0) ?? 0;
  if (bestRating !== currentRating) {
    clone.querySelector("#profilestats-csstats_premier_rating_best").appendChild(createPremierRating(bestRating))
  } else {
    clone.querySelector("#profilestats-csstats_premier_indicator").textContent = "(Best)"
    clone.querySelector("#profilestats-csstart_premier_container_best").style.display = "none";
  }

  clone.querySelector("#profilestats-csstats_kd_ratio").textContent = stats.kd_ratio ?? "-"
  clone.querySelector("#profilestats-csstats_hltv").textContent = stats.hltv_rating ?? "-"
  clone.querySelector("#profilestats-csstats_matches").textContent = stats.matches ?? "-"

  const winRate = stats.win_rate
  clone.querySelector("#profilestats-csstats_win_rate").textContent = `${winRate ? winRate + "%" : "-"}`

  const hs = stats.hs_percentage
  clone.querySelector("#profilestats-csstats_hs_percentage").textContent = hs != null ? `${hs}%` : "-"

  clone.querySelector("#profilestats-csstats_adr").textContent = stats.adr ?? "-"

  const clutching = stats.clutch
  clone.querySelector("#profilestats-csstats_clutching").textContent = `${clutching ? clutching + "%" : "-"}`

  clone.querySelector("#profilestats-csstats_most_played").textContent = stats.most_played_map ?? "-"

  const compRanks = stats.competitive_ranks ?? [];
  const wingman = stats.wingman;
  const premierRatings = stats.premier_ratings ?? [];

  ranksEl.innerHTML = ""

  if (compRanks.length > 0) {
    const left = document.createElement("div")
    left.classList.add("profilestats-ranks-left")
    const { container, grid } = createRanksSection("Competitive", ["Map", "Current", "Best"], "profilestats-ranks-competitive")
    compRanks.forEach(rank => appendCompRow(grid, rank))
    left.appendChild(container)
    ranksEl.appendChild(left)
  }

  const right = document.createElement("div")
  right.classList.add("profilestats-ranks-right")

  if (premierRatings.length > 0) {
    const { container, grid } = createRanksSection("Premier", ["Season", "Current", "Best"], "profilestats-ranks-premier")
    premierRatings.forEach(rating => appendPremierRow(grid, rating))
    right.appendChild(container)
  }

  if (wingman != null) {
    const { container, grid } = createRanksSection("Wingman", ["Mode", "Current", "Best"], "profilestats-wingman_rank")
    appendWingmanRow(grid, wingman)
    right.appendChild(container)
  }

  if (right.hasChildNodes()) {
    ranksEl.appendChild(right)
  }
}

function createFaceitLevel(level, ranking) {
  const img = document.createElement("img");
  img.src = getFaceitLevelImage(level, ranking);
  img.title = String(ranking);
  const color = getFaceitColor(level)
  img.style.setProperty("filter", `drop-shadow(${color}60 0px 0px 5px)`)
  return img;
}

function fillFaceit(clone, faceitData) {
  if (!faceitData || faceitData.error) {
    const message = faceitData?.status === 404 ? "Faceit profile not found." : "Couldn't load FaceIt data.";
    clone.querySelector("#profilestats-faceit_content").textContent = message;
    clone.querySelector(".profilestats-faceit").dataset.failed = "true"
    return;
  }

  clone.querySelector("#profilestats-faceit_profile").style.display = "";

  const stats = faceitData.stats;
  const level = faceitData.level;
  const ranking = faceitData.ranking;

  const nickname = faceitData.nickname;
  clone.querySelector("#profilestats-faceit_category_logo").href = `https://www.faceit.com/en/players/${nickname ?? ""}`;
  const levelEl = clone.querySelector("#profilestats-faceit_level")
  levelEl.innerHTML = ""
  levelEl.appendChild(createFaceitLevel(level, ranking))
  clone.querySelector("#profilestats-faceit_nickname").textContent = nickname ?? "-";

  const country = faceitData.country;
  clone.querySelector("#profilestats-faceit_flag").src = country ? `https://flagsapi.com/${country.toUpperCase()}/flat/24.png` : "";

  const membership = faceitData.membership
  const formattedMembership = membership != null ? membership.charAt(0).toUpperCase() + membership.slice(1) : "-"
  clone.querySelector("#profilestats-faceit_membership").textContent = formattedMembership

  const banEl = clone.querySelector("#profilestats-faceit_ban");
  const banEnds = faceitData.ban_ends != null ? `(${formatDate(getTimeDiff(faceitData.ban_ends, "until"))} left)` : ""
  if (faceitData.banned) {
    banEl.style.display = "";
    clone.querySelector("#profilestats-faceit_ban_reason").textContent = `Banned for ${faceitData.ban_reason?.toLowerCase() ?? "unknown"} ${banEnds}`;
    clone.querySelector("#profilestats-faceit_ban_reason").style.color = faceitData.ban_ends === null ? "red" : "orange"
  } else {
    banEl.style.display = "none";
  }

  const registered = faceitData.registered;
  if (registered != null) {
    clone.querySelector("#profilestats-faceit_registered").textContent = `(${formatDate(getTimeDiff(registered))})`;
  } else {
    clone.querySelector("#profilestats-faceit_registered").textContent = "-";
  }

  const eloEl = clone.querySelector("#profilestats-faceit_elo")
  eloEl.textContent = faceitData.elo ?? "-";
  eloEl.style.color = getFaceitColor(level)

  clone.querySelector("#profilestats-faceit_matches").textContent = stats.matches ?? "-";
  clone.querySelector("#profilestats-faceit_kd_ratio").textContent = stats.kd_ratio ?? "-";

  const hs = stats.hs_percentage;
  clone.querySelector("#profilestats-faceit_hs_percentage").textContent = hs != null ? `${hs}%` : "-";

  const winRate = stats.win_rate;
  clone.querySelector("#profilestats-faceit_win_rate").textContent = winRate != null ? `${winRate}%` : "-";

  const avgKills = stats.avg_kills ?? "-"
  const avgDeaths = stats.avg_deaths ?? "-"
  const avgAssists = stats.avg_assists ?? "-"
  clone.querySelector("#profilestats-faceit_avg_kda").textContent = `${avgKills}/${avgDeaths}/${avgAssists}`;

  const lastMatch = faceitData.last_match;
  const formattedLastMatch = lastMatch != null ? formatLastMatchDate(lastMatch) : "-"
  clone.querySelector("#profilestats-faceit_last_match").textContent = formattedLastMatch


  const recentContainer = clone.querySelector("#profilestats-faceit_recent_results");
  const recentResults = stats.recent_results;
  if (recentResults?.length > 0) {
    recentResults.forEach(result => {
      const span = document.createElement("span");
      span.textContent = result;
      span.style.color = result === "W" ? "#86fc8c" : "#ff879b";
      recentContainer.appendChild(span);
    });
  } else {
    recentContainer.textContent = "-";
  }
}

function fillCS2Locker(clone, cs2lockerData) {
  if (!cs2lockerData || cs2lockerData.error) {
    const message = cs2lockerData?.status === 403 ? "Inventory is private or profile not found." : "Couldn't load CS2Locker data.";
    clone.querySelector("#profilestats-cs2locker_content").textContent = message;
    clone.querySelector("#profilestats-cs2locker_profile").style.display = "none"
    clone.querySelector(".profilestats-cs2locker").dataset.failed = "true"
    return;
  }

  if (cs2lockerData.top5Items.length === 0) {
    clone.querySelector("#profilestats-cs2locker_value").textContent = "Inventory is empty"
    return
  }

  clone.querySelector("#profilestats-cs2locker_show_button").style.display = ""

  const currency = cs2lockerData.currency ?? ""
  const inventoryValue = cs2lockerData.estimatedValue ?? "-"

  clone.querySelector("#profilestats-cs2locker_value_number").textContent = `~${inventoryValue}${currency}`

  const detailsEl = clone.querySelector("#profilestats-cs2locker_details");

  const showBtn = clone.querySelector("#profilestats-cs2locker_show_button");

  showBtn.addEventListener("click", () => {
    const isVisible = detailsEl.style.display !== "none";
    detailsEl.style.display = isVisible ? "none" : "";
    showBtn.textContent = isVisible ? "Show best skins" : "Hide best skins";
  });

  const top5 = cs2lockerData.top5Items ?? [];

  top5.forEach(skin => detailsEl.appendChild(createLockerSkin(skin, currency)))
}

function createStyles() {
  return `
    .profilestats-customization_header { display: flex; flex-direction: row; justify-content: space-between; }
    #profilestats-customization_header_start { display: flex; flex-direction: row; align-items: center; gap: 10px; }
    #profilestats-customization_header_end { display: flex; flex-direction: row; align-items: center; gap: 5px }
    #profilestats-customization_header_end > button { color: white; font-size: 15px; line-height: 30px; background: rgba(0,0,0,0.3); border: none; border-radius: 3px; height: 30px; width: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
    #profilestats-customization_header_end > button:hover { filter: brightness(0.8) }
    .profilestats-links { display: flex; flex-direction: row; align-items: center; gap: 3px; }
    .profilestats-links > a { padding: 5px; border-radius: 3px; display: flex; height: 20px; background: rgba(0,0,0,0.3); }
    .profilestats-links > a:hover { filter: brightness(0.8); }
    .profilestats-header_start { display: flex; flex-direction: row; align-items: center; gap: 10px; }
    .profilestats-header_end { display: flex; flex-direction: row; align-items: center; gap: 10px; }
    .profilestats-header { display: flex; flex-direction: row; justify-content: space-between; align-items: center; min-height: 40px; margin-bottom: 8px; }
    .profilestats-category_logo { display: flex; flex-direction: row; justify-content: start; align-items: center; background: rgba(0,0,0,0.3); height: 30px; padding: 4px; border-radius: 5px; }
    .profilestats-category_logo:hover { filter: brightness(0.8); }
    .profilestats-category_logo > img { height: 100%; }
    .profilestats-updown { display: flex; flex-direction: column; justify-content: center; height: 40px }
    .profilestats-updown_button { background: none; border: none; cursor: default; height: 30%; filter: brightness(0.5); display: flex; align-items: center; justify-content: center; }
    .profilestats-updown_button:hover { filter: brightness(0.7); }
    .profilestats-updown_button > img { height: 100%; }
    #profilestats-leetify_badge { height: 40px; }
    #profilestats-leetify_badge > img { height: 100%; }
    .profilestats-tab { background: none; border: none; color: white; cursor: pointer; }
    .profilestats-tab.active-tab { border-bottom: 1px solid white; margin-bottom: -1px; }
    .profilestats-separator { font-size: 17px; font-weight: bold; }
    .profilestats-ban { display: flex; flex-direction: row; gap: 5px; align-items: center; }
    .profilestats-ban_reason { font-size: 15px; color: red; }
    .profilestats-details { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; }
    .profilestats-details > div { color: #c4c4c4; font-size: 16px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: rgba(0,0,0,0.3); border-radius: 3px; padding: 4px; height: fit-content; }
    .profilestats-details > div > span { color: white; font-size: 14px; }
    .profilestats-premier-rating { height: 28px; display: flex; position: relative; }
    .profilestats-premier-rating > span { position: absolute; line-height: 28px; font-size: 15px; font-weight: 700; width: 100%; text-align: center; text-indent: 10px; transform: skew(-10deg, 0deg); }
    .profilestats-ranks { display: flex; flex-direction: row; gap: 5px; margin-top: 8px; padding-top: 8px; border-top: 1px solid #969696; }
    .profilestats-ranks-competitive { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 5px 10px; width: 100%; }
    .profilestats-leetify-ranks-competitive { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 5px 10px; width: 100%; }
    .profilestats-rank_left { display: flex; flex-direction: row; gap: 5px; align-items: center; }
    .profilestats-rank_left > img { height: 40px; }
    .profilestats-rank_left_text { display: flex; flex-direction: column; align-items: start; justify-content: center; }
    .profilestats-rank_left_top_text { font-weight: bold; color: white; font-size: 13px; }
    .profilestats-rank_left_bottom_text { color: #c4c4c4; font-size: 12px; }
    .profilestats-rank-icon > img { height: 28px; }
    .profilestats-ranks-header { color: #969696; font-size: 15px; text-align: center; }
    .profilestats-ranks-header:nth-child(1) { text-align: left; text-indent: 5px; }
    .profilestats-ranks-left, .profilestats-ranks-right { display: flex; flex-direction: column; gap: 10px; width: 50%; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 3px; }
    .profilestats-ranks-section { display: flex; flex-direction: column; }
    .profilestats-ranks-section-label { font-size: 18px; color: white; }
    .profilestats-ranks-premier { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 5px 5px; align-self: start; width: 100%; }
    .profilestats-wingman_rank { display: grid; grid-template-columns: 1fr auto auto; align-items: center; gap: 5px 10px; }
    .profilestats-leetify-wingman_rank { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 5px 10px; align-self: start; width: 100%; }
    #profilestats-steam_details > div { color: #c4c4c4; font-size: 16px; }
    #profilestats-steam_details > div > span { color: white; font-size: 14px; }
    #profilestats-steam_profile_header { display: flex; flex-direction: row; align-items: center; gap: 5px; }
    #profilestats-steam_name { font-size: 18px; color: white; }
    #profilestats-steam_steamid64 { font-size: 15px; color: #969696; cursor: pointer; }
    #profilestats-leetify_profile_header { display: flex; flex-direction: row; gap: 5px }
    #profilestats-leetify_name { color: white; font-size: 18px; }
    #profilestats-csstats_profile_header { display: flex; flex-direction: row; gap: 10px }
    #profilestats-csstats_name { color: white; font-size: 20px; }
    .profilestats-csstart_premier_container { display: flex; flex-direction: row; gap: 5px; }
    .profilestats-csstats_premier_label { color: white; font-size: 20px; line-height: 28px; }
    #profilestats-csstats_premier_indicator { font-size: 16px; line-height: 28px; }
    #profilestats-faceit_profile_header { display: flex; flex-direction: row; align-items: center; gap: 5px }
    #profilestats-faceit_level { height: 36px; }
    #profilestats-faceit_level > img { height: 100%; }
    #profilestats-faceit_name_col { display: flex; flex-direction: column; justify-content: center }
    #profilestats-faceit_name { display: flex; flex-direction: row; align-items: center; gap: 5px }
    #profilestats-faceit_nickname { color: white; font-size: 18px; }
    #profilestats-faceit_membership { color: #969696; font-size: 17px; }
    #profilestats-faceit_ban_reason { font-size: 10px; font-weight: 500; }
    #profilestats-faceit_recent_results { display: flex; gap: 3px; justify-content: center; }
    #profilestats-cs2locker_badge { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 40px; }
    #profilestats-cs2locker_badge > span { font-size: 13px; color: white; white-space: nowrap; }
    #profilestats-cs2locker_badge > img { height: 15px; width: auto; }
    #profilestats-cs2locker_value { color: white; font-size: 18px; }
    #profilestats-cs2locker_value_number { color: #969696; font-size: 17px; }
    .profilestats-show_button { color: #c4c4c4; background: rgba(0,0,0,0.3); border: none; border-radius: 3px; cursor: pointer; height: fit-content; }
    .profilestats-show_button:hover { filter: brightness(0.8) }
    #profilestats-cs2locker_details { display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin-top: 8px; }
    .profilestats-cs2locker_skin { display: flex; flex-direction: column; align-items: center; background: rgba(0,0,0,0.3); border-radius: 3px; padding: 4px; min-width: 0; }
    .profilestats-cs2locker_skin_inner { position: relative; margin-bottom: 4px; padding-bottom: 4px; border-bottom: 1px solid #969696; width: 100%; display: flex; justify-content: center; }
    .profilestats-cs2locker_skin_image { height: 70px; width: auto; }
    .profilestats-cs2locker_skin_pricetag { position: absolute; bottom: 4px; right: 0; background: rgba(0,0,0,0.3); color: white; font-size: 11px; padding: 2px; border-radius: 2px; }
    .profilestats-cs2locker_skin_info { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; min-width: 0; flex: 1; }
    .profilestats-cs2locker_stickers { display: grid; grid-template-columns: repeat(5, 1fr); width: 100%; direction: rtl; }
    .profilestats-cs2locker_sticker { display: block; min-width: 0; }
    .profilestats-cs2locker_sticker_image { width: 100%; height: 100%; object-fit: contain; }
    .profilestats-cs2locker_skin_fv { font-size: 11px; text-align: right; }
    .profilestats-cs2locker_skin_name { font-size: 11px; text-align: right; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .profilestats-cs2locker_skin_name:hover { text-decoration: underline }
    .profilestats-settings { display: flex; flex-direction: row; align-items: center; justify-content: end; gap: 5px; flex-wrap: wrap; }
    .profilestats-checkbox { display: flex; align-items: center; background: rgba(0,0,0,0.3); padding: 5px; border-radius: 3px; }
    .profilestats-checkbox > label { margin-right: 0 }

    @media (orientation: portrait) {
      .profilestats-ranks { flex-direction: column }
      .profilestats-ranks > div { width: 100%; box-sizing: border-box; }
    }

    .profilestats-compact [data-compact="hidden"] { display: none !important; }
    .profilestats-compact #profilestats-leetify_content > .profilestats-details { grid-template-columns: repeat(6, 1fr) !important; }
    .profilestats-compact #profilestats-faceit_content > .profilestats-details { grid-template-columns: repeat(6, 1fr) !important; }

    .profilestats-screenshot [data-screenshot="hidden"] { display: none !important; }
    .profilestats-edit .profilestats-updown { display: flex !important; }

    .profilestats-hide-failed [data-failed="true"] { display: none !important; }
  `;
}

async function setupSettings(el, fetchers) {

  const settingsBtn = el.querySelector(".profilestats-settings_button");
  const settingsEl = el.querySelector(".profilestats-settings");

  settingsBtn.addEventListener("click", () => {
    const isVisible = settingsEl.style.display !== "none";
    settingsEl.style.display = isVisible ? "none" : "";
  });

  const saved = await chrome.storage.local.get("profilestats:settings");
  const settings = saved["profilestats:settings"] || {
    startCollapsed: false,
    compactMode: false,
    showSteam: true,
    showLeetify: true,
    showCSStats: true,
    showFaceit: true,
    showCS2Locker: false,
    hideFailed: false,
  };

  const failedCb = el.querySelector("#profilestats-checkbox-failed");
  failedCb.checked = settings.hideFailed;
  el.classList.toggle("profilestats-hide-failed", settings.hideFailed);

  failedCb.addEventListener("change", async () => {
    settings.hideFailed = failedCb.checked;
    el.classList.toggle("profilestats-hide-failed", failedCb.checked);
    await chrome.storage.local.set({ "profilestats:settings": settings });
  });

  const block = el.querySelector(".profile_customization_block");
  const collapseBtn = el.querySelector(".profilestats-collapse_button");
  const collapseCb = el.querySelector("#profilestats-checkbox-collapsed");

  collapseCb.checked = settings.startCollapsed;

  if (settings.startCollapsed) {
    block.style.display = "none";
    collapseBtn.textContent = "▼";
  }

  collapseCb.addEventListener("change", async () => {
    settings.startCollapsed = collapseCb.checked;
    await chrome.storage.local.set({ "profilestats:settings": settings });
  });

  collapseBtn.addEventListener("click", () => {
    const isCollapsed = collapseBtn.textContent === "▼";
    collapseBtn.textContent = isCollapsed ? "▲" : "▼";
    block.style.display = isCollapsed ? "block" : "none";
  });

  const screenshotBtn = el.querySelector("#profilestats-button-screenshot")
  screenshotBtn.addEventListener("click", () => {
    el.classList.toggle("profilestats-screenshot")
  })

  const editBtn = el.querySelector("#profilestats-button-edit")
  editBtn.addEventListener("click", () => {
    el.classList.toggle("profilestats-edit")
  })

  const compactCb = el.querySelector("#profilestats-checkbox-compact");
  compactCb.checked = settings.compactMode;

  el.classList.toggle("profilestats-compact", settings.compactMode)

  compactCb.addEventListener("change", async () => {
    settings.compactMode = compactCb.checked;
    el.classList.toggle("profilestats-compact", compactCb.checked)
    await chrome.storage.local.set({ "profilestats:settings": settings });
  });

  const visibilityItems = [
    { id: "profilestats-checkbox-show_steam", key: "showSteam", element: ".profilestats-steam" },
    { id: "profilestats-checkbox-show_leetify", key: "showLeetify", element: ".profilestats-leetify" },
    { id: "profilestats-checkbox-show_csstats", key: "showCSStats", element: ".profilestats-csstats" },
    { id: "profilestats-checkbox-show_faceit", key: "showFaceit", element: ".profilestats-faceit" },
    { id: "profilestats-checkbox-show_cs2locker", key: "showCS2Locker", element: ".profilestats-cs2locker" },
  ]

  visibilityItems.forEach(({ id, key, element }) => {
    const checkbox = el.querySelector(`#${id}`);
    const section = el.querySelector(element);
    if (!checkbox || !section) return;

    checkbox.checked = settings[key] ?? true;
    section.style.display = checkbox.checked ? "" : "none";

    // only fetch if visible
    if (checkbox.checked) fetchers[key]?.();

    checkbox.addEventListener("change", async () => {
      settings[key] = checkbox.checked;
      section.style.display = checkbox.checked ? "" : "none";
      if (checkbox.checked) fetchers[key]?.();
      await chrome.storage.local.set({ "profilestats:settings": settings });
    });
  });
}

async function setupUpDown(el) {
  const block = el.querySelector(".profile_customization_block");

  const saved = await chrome.storage.local.get("profilestats:order");
  const order = saved["profilestats:order"];
  if (order?.length) {
    order.forEach(sectionClass => {
      const section = block.querySelector(`.${sectionClass}`);
      if (section) block.appendChild(section);
    });
  }

  const getSectionId = (section) =>
    [...section.classList].find(c => c.startsWith("profilestats-") && c !== "showcase_content_bg");

  const saveOrder = async () => {
    const sections = [...block.querySelectorAll(".showcase_content_bg")];
    const order = sections.map(getSectionId);
    await chrome.storage.local.set({ "profilestats:order": order });
  };

  block.querySelectorAll(".profilestats-updown").forEach(updown => {
    const section = updown.closest(".showcase_content_bg");

    updown.querySelector(".profilestats-updown_button_up").addEventListener("click", () => {
      const prevSibling = section.previousElementSibling;
      if (prevSibling && !prevSibling.classList.contains("profilestats-settings")) {
        block.insertBefore(section, prevSibling);
        saveOrder();
      }
    });

    updown.querySelector(".profilestats-updown_button_down").addEventListener("click", () => {
      const nextSibling = section.nextElementSibling;
      if (nextSibling && !nextSibling.classList.contains("profilestats-settings")) {
        block.insertBefore(nextSibling, section);
        saveOrder();
      }
    });
  });
}

async function renderStats(el, head) {
  if (!el) return;
  const path = window.location.pathname;
  const profilePage = path.match(/^\/(profiles|id)\/[^\/]+\/?$/);
  if (!profilePage) return;

  const steamId64 = await getSteamId(window.location.href);
  if (!steamId64) return;

  const status = await backgroundFetch(`${API_URL}/api/status`);
  if (!status || status.error) return;

  const logos = {
    steamLogo: chrome.runtime.getURL("assets/logos/steam_logo.png"),
    leetifyLogo: chrome.runtime.getURL("assets/logos/leetify_logo.png"),
    leetifyBadge: chrome.runtime.getURL("assets/logos/leetify_badge.png"),
    csstatsLogo: chrome.runtime.getURL("assets/logos/csstats_logo.png"),
    faceitLogo: chrome.runtime.getURL("assets/logos/faceit_logo.png"),
    cs2lockerLogo: chrome.runtime.getURL("assets/logos/cs2locker_logo.png"),
    cs2lockerBadge: chrome.runtime.getURL("assets/logos/cs2locker_badge.png"),
    csrepLogo: chrome.runtime.getURL("assets/logos/csrep_logo.png"),
    steamidLogo: chrome.runtime.getURL("assets/logos/steamid_logo.png"),
    csfloatLogo: chrome.runtime.getURL("assets/logos/csfloat_logo.png"),
    steamhistoryLogo: chrome.runtime.getURL("assets/logos/steamhistory_logo.png")
  };

  const uiIcons = {
    settings: chrome.runtime.getURL("assets/ui/settings.svg"),
    chevronUp: chrome.runtime.getURL("assets/ui/chevron_up.svg"),
    chevronDown: chrome.runtime.getURL("assets/ui/chevron_down.svg"),
  };

  const isGamesPrivate = document.querySelector('.profile_recentgame_header') === null;
  const clone = createTemplate(logos, uiIcons);

  const steamBackup = clone.querySelector("#profilestats-steam_content").innerHTML;
  const leetifyBackup = clone.querySelector("#profilestats-leetify_content").innerHTML;
  const csStatsBackup = clone.querySelector("#profilestats-csstats_content").innerHTML;
  const faceitBackup = clone.querySelector("#profilestats-faceit_content").innerHTML;
  const cs2lockerBackup = clone.querySelector("#profilestats-cs2locker_content").innerHTML;

  const loadingAnimation = `
    <div id="profilestats-loading" style="display: flex; align-items: center; margin-top: 8px;">
      <svg style="color: white" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z">
          <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/>
        </path>
      </svg>
    </div>
  `

  const styleEl = document.createElement("style");
  styleEl.textContent = createStyles();
  head.appendChild(styleEl);

  el.prepend(clone);
  setupUpDown(el);

  const fetcher = (fetchFn, fillFn, contentEl, backup) => {
    let loaded = false
    return () => {
      if (loaded) return;
      loaded = true;
      el.querySelector(contentEl).innerHTML = loadingAnimation;
      fetchFn(steamId64).then(data => {
        el.querySelector(contentEl).innerHTML = backup;
        fillFn(el, data)
      })
    }
  }

  const fetchers = {
    showSteam: fetcher(
      fetchSteamProfile,
      (el, data) => fillSteam(el, data, steamId64, isGamesPrivate),
      "#profilestats-steam_content",
      steamBackup,
    ),
    showLeetify: fetcher(
      fetchLeetifyProfile,
      fillLeetify,
      "#profilestats-leetify_content",
      leetifyBackup,
    ),
    showCSStats: fetcher(
      fetchCSStatsProfile,
      fillCSStats,
      "#profilestats-csstats_content",
      csStatsBackup,
    ),
    showCS2Locker: fetcher(
      fetchCS2Locker,
      fillCS2Locker,
      "#profilestats-cs2locker_content",
      cs2lockerBackup,
    ),
    showFaceit: (() => {
      // faceit is a little more complicated since we have csgo and cs2 to handle
      let loaded = false;
      return () => {
        if (loaded) return;
        loaded = true;
        const content = el.querySelector("#profilestats-faceit_content");
        content.innerHTML = loadingAnimation;

        Promise.all([
          fetchFaceitProfile(steamId64),
          fetchFaceitCsgoProfile(steamId64),
        ]).then(([cs2Data, csgoData]) => {
          const csData = { cs2: cs2Data, csgo: csgoData };
          const initialGame = (!cs2Data || cs2Data.error) ? "csgo" : "cs2";

          content.innerHTML = faceitBackup;
          fillFaceit(el, csData[initialGame]);

          el.querySelectorAll(".profilestats-tab").forEach(btn => {
            const game = btn.dataset.game;
            const data = csData[game];

            btn.style.display = (!data || data.error) ? "none" : "";
            btn.classList.toggle("active-tab", game === initialGame);

            btn.addEventListener("click", () => {
              el.querySelectorAll(".profilestats-tab").forEach(t => t.classList.remove("active-tab"));
              btn.classList.add("active-tab");
              el.querySelector("#profilestats-faceit_recent_results").innerHTML = "";
              fillFaceit(el, csData[game]);
            });
          });
        });
      };
    })(),
  }

  fillLinks(el, steamId64)
  await setupSettings(el, fetchers);
}

renderStats(
  document.querySelector(".profile_leftcol"),
  document.querySelector("head")
);
