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

function backgroundFetch(url) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: "fetch", url }, resolve);
  });
}

async function resolveVanity(vanity) {
  return cachedFetch(`steamid:${vanity}`, async () => {
    const data = await backgroundFetch(`${API_URL}/api/resolveVanity/${vanity}`);
    return data?.["steam_id"] ?? null;
  });
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

async function fetchCSStatsProfile(steamId64) {
  return cachedFetch(`csstats:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/csstats/${steamId64}`)
  );
}

async function fetchSteamProfile(steamId64) {
  return cachedFetch(`steam:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/steam/${steamId64}`)
  );
}

function howLongAgo(dateStr) {
  const past = new Date(dateStr);
  const now = new Date();

  let years = now.getFullYear() - past.getFullYear();
  let months = now.getMonth() - past.getMonth();

  if (months < 0) {
    years--;
    months += 12;
  }

  return { years, months };
}

function getPremierColor(rating) {
  if (rating < 5000)  return "#b0c3d9";
  if (rating < 10000) return "#8cc6ff";
  if (rating < 15000) return "#6a7dff";
  if (rating < 20000) return "#c166ff";
  if (rating < 25000) return "#f03cff";
  if (rating < 30000) return "#eb4b4b";
  if (rating >= 30000) return "#ffd700";
  return "#c4cce2";
}

function getPremierBg(bgs, rating) {
  if (rating < 5000) return bgs["grey"];
  if (rating < 10000) return bgs["lightblue"];
  if (rating < 15000) return bgs["blue"];
  if (rating < 20000) return bgs["purple"];
  if (rating < 25000) return bgs["pink"];
  if (rating < 30000) return bgs["red"];
  return bgs["gold"];
}

function getFaceitColor(level) {
  if (level === 1) return "#dddddd";
  if (level === 2 || level === 3) return "#47e66e";
  if (level >= 4 && level <= 7) return "#fecd23";
  if (level === 8 || level === 9) return "#fd6c1e";
  if (level === 10) return "#e80026";
  return "#dddddd";
}

function getFaceitLevelImage(faceitLevels, level, ranking) {
  if (ranking >= 1000 || ranking == 0) {
    return faceitLevels[level]
  } else {
    return faceitLevels["challenger"]
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

function createTemplate(images) {
  const { steamLogo, leetifyLogo, leetifyBadge, faceitLogo } = images;

  const template = document.createElement("template");
  template.innerHTML = `
    <div class="profile_customization">
      <div class="profile_customization_header profilestats-customization_header">
        <div>CS2 Profile Stats</div>
        <div class="profilestats-button_group">
          <a id="profilestats-csrep_button" class="profilestats-links_button" href="#" target="_blank"><div>CSRep</div></a>
          <a id="profilestats-csstats_button" class="profilestats-links_button" href="#" target="_blank"><div>CSStats</div></a>
        </div>
        <button class="profilestats-collapse_button">▲</button>
      </div>
      <div class="profile_customization_block">
        <div class="showcase_content_bg profilestats-steam">
          <div class="profilestats-header">
            <a class="profilestats-category_logo_name" id="profilestats-steam_category_logo_name">
              <img src="${steamLogo}"/>
              <div class="profilestats-category_name">Steam</div>
            </a>
          </div>
          <div id="profilestats-steam_content">
            <div id="profilestats-steam_profile">
              <div>SteamID64: <span id="profilestats-steam_steamid64"></span></div>
              <div>Created: <span id="profilestats-steam_registered"></span></div>
              <div>CS2 Playtime: <span id="profilestats-steam_cs2_playtime"></span></div>
            </div>
          </div>
        </div>
        <div class="showcase_content_bg profilestats-leetify">
          <div class="profilestats-header">
            <a class="profilestats-category_logo_name" id="profilestats-leetify_category_logo_name">
              <img src="${leetifyLogo}"/>
              <div class="profilestats-category_name">Leetify</div>
            </a>
            <img src="${leetifyBadge}"/>
          </div>
          <div id="profilestats-leetify_content">
            <div id="profilestats-leetify_profile">
              <div id="profilestats-leetify_profile_header">
                <div class="profilestats-premier-rating">
                  <img id="profilestats-leetify_premier_bg"/>
                  <span id="profilestats-leetify_premier_rating"></span>
                </div>
                <div><span id="profilestats-leetify_name"></span></div>
              </div>
            </div>
            <div class="profilestats-details">
              <div>Rating<span id="profilestats-leetify_leetify_rating"></span></div>
              <div>Matches<span id="profilestats-leetify_matches"></span></div>
              <div>First match<span id="profilestats-leetify_first_match"></span></div>
              <div>Winrate<span id="profilestats-leetify_win_rate"></span></div>
              <div>Aim<span id="profilestats-leetify_aim_rating"></span></div>
              <div>Positioning<span id="profilestats-leetify_positioning"></span></div>
              <div>Utility<span id="profilestats-leetify_utility"></span></div>
              <div>Clutching<span id="profilestats-leetify_clutching"></span></div>
              <div>Opening<span id="profilestats-leetify_opening"></span></div>
              <div>Preaim&#176;<span id="profilestats-leetify_preaim_angle"></span></div>
              <div>Reaction<span id="profilestats-leetify_reaction_time"></span></div>
            </div>
          </div>
        </div>
        <!--<div class="showcase_content_bg profilestats-csstats">
          <div class="profilestats-header">
            <a class="profilestats-category_logo_name" id="profilestats-csstats_category_logo_name">
              <div class="profilestats-category_name" id="profilestats-csstats_category_name">CS<span>STATS</span>.GG</div>
            </a>
          </div>
          <div id="profilestats-csstats_content">
            <div id="profilestats-csstats_profile">
              <div id="profilestats-csstats_profile_header">
                <span id="profilestats-csstats_premier_rating"></span>
                <div><span id="profilestats-csstats_name"></span></div>
              </div>
            </div>
            <div class="profilestats-details">
              <div>K/D<span id="profilestats-csstats_kd_ratio"></span></div>
              <div>HLTV Rating<span id="profilestats-csstats_hltv"></span></div>
              <div>Matches<span id="profilestats-csstats_matches"></span></div>
              <div>Winrate<span id="profilestats-csstats_win_rate"></span></div>
              <div>HS%<span id="profilestats-csstats_hs_percentage"></span></div>
              <div>ADR<span id="profilestats-csstats_adr"></span></div>
              <div>Clutching<span id="profilestats-csstats_clutching"></span></div>
              <div>Most played<span id="profilestats-csstats_most_played"></span></div>
            </div>
          </div>
        </div>-->
        <div class="showcase_content_bg profilestats-faceit">
          <div class="profilestats-header">
            <a class="profilestats-category_logo_name" id="profilestats-faceit_category_logo_name">
              <img src="${faceitLogo}"/>
              <div class="profilestats-category_name">FaceIt</div>
            </a>
            <div class="profilestats-tabs">
              <button class="profilestats-tab active-tab" data-game="cs2">CS2</button>
              <button class="profilestats-tab" data-game="csgo">CS:GO</button>
            </div>
          </div>
          <div id="profilestats-faceit_content">
            <div id="profilestats-faceit_profile">
              <div id="profilestats-faceit_profile_header">
                <img id="profilestats-faceit_level"/>
                <img id="profilestats-faceit_flag"/>
                <span id="profilestats-faceit_nickname"></span>
                <span class="profilestats-separator"> | </span>
                <div style="font-size: 17px">Faceit <span id="profilestats-faceit_membership"></span></div>
                <div class="profilestats-ban" id="profilestats-faceit_ban" style="display: none"><span class="profilestats-separator">|</span><span class="profilestats-ban_reason" id="profilestats-faceit_ban_reason"></span></div>
              </div>
            </div>
            <div class="profilestats-details">
              <div>Created<span id="profilestats-faceit_registered"></span></div>
              <div>Elo<span id="profilestats-faceit_elo"></span></div>
              <div>Matches<span id="profilestats-faceit_matches"></span></div>
              <div>K/D<span id="profilestats-faceit_kd_ratio"></span></div>
              <div>HS%<span id="profilestats-faceit_hs_percentage"></span></div>
              <div>WR%<span id="profilestats-faceit_win_rate"></span></div>
              <div>Recent<span id="profilestats-faceit_recent_results"></span></div>
              <div>AVG Kills<span id="profilestats-faceit_avg_kills"></span></div>
            </div>
          </div>
        </div>
        <div class="showcase_content_bg profilestats-settings">
          <label for="profilestats-checkbox-collapsed">Start collapsed</label>
          <input type="checkbox" id="profilestats-checkbox-collapsed">
        </div>
      </div>
    </div>
  `;

  return template.content.cloneNode(true);
}

function fillSteam(clone, steamData, steamId64, isGamesPrivate) {
  if (!steamData || steamData.error) {
    clone.querySelector("#profilestats-steam_content").textContent = "Couldn't load Steam data";
    return;
  }

  clone.querySelector("#profilestats-steam_category_logo_name").href = `https://steamcommunity.com/profiles/${steamId64}`;
  clone.querySelector("#profilestats-csrep_button").href = `https://csteamcommunity.com/profiles/${steamId64}`;
  clone.querySelector("#profilestats-csstats_button").href = `https://xsteamcommunity.com/profiles/${steamId64}`;
  clone.querySelector("#profilestats-steam_steamid64").textContent = steamId64;

  const registered = steamData["registered"]
  if (registered != null) {
    const { years, months } = howLongAgo(registered);
    clone.querySelector("#profilestats-steam_registered").textContent = `${years}y, ${months}m ago`;
  } else {
    clone.querySelector("#profilestats-steam_registered").textContent = "-";
  }


  const playtime = steamData["cs2_playtime"];
  if (playtime != null) {
    const formattedPlaytime = new Intl.NumberFormat("en-US").format(playtime);
    clone.querySelector("#profilestats-steam_cs2_playtime").textContent = `${formattedPlaytime}h`;
  } else {
    clone.querySelector("#profilestats-steam_cs2_playtime").textContent = `${isGamesPrivate ? "Private" : "-"}`;
  }
}

function fillLeetify(clone, leetifyData, steamId64, premierBgs) {
  if (!leetifyData || leetifyData.error) {
    clone.querySelector("#profilestats-leetify_content").textContent = "Couldn't load Leetify data"
    return 0;
  }

  const stats = leetifyData["stats"];
  const premierRating = stats["premier_rating"];
  const formattedRating = new Intl.NumberFormat("en-US").format(premierRating);
  const premierBg = getPremierBg(premierBgs, premierRating)

  clone.querySelector("#profilestats-leetify_category_logo_name").href = `https://leetify.com/app/profile/${steamId64}`;
  clone.querySelector("#profilestats-leetify_name").textContent = `${leetifyData["name"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_premier_bg").src = premierBg
  clone.querySelector("#profilestats-leetify_premier_rating").textContent = `${premierRating == null || premierRating === 0 ? "---" : formattedRating}`
  clone.querySelector("#profilestats-leetify_leetify_rating").textContent = `${stats["leetify_rating"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_matches").textContent = `${stats["matches"] ?? "-"}`;

  const firstMatch = stats["first_match"]
  if (firstMatch != null) {
    const { years, months } = howLongAgo(firstMatch);
    clone.querySelector("#profilestats-leetify_first_match").textContent = `${years}y, ${months}m ago`;
  } else {
    clone.querySelector("#profilestats-leetify_first_match").textContent = "";
  }


  const winRate = stats["win_rate"]
  clone.querySelector("#profilestats-leetify_win_rate").textContent = winRate != null ? `${winRate}%` : "-";
  clone.querySelector("#profilestats-leetify_aim_rating").textContent = `${stats["aim_rating"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_positioning").textContent = `${stats["positioning"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_utility").textContent = `${stats["utility"] ?? "-"}`;

  const clutching = stats["clutching"];
  clone.querySelector("#profilestats-leetify_clutching").textContent = clutching != null ? (clutching > 0 ? `+${clutching}` : clutching) : "-";

  const opening = stats["opening"];
  clone.querySelector("#profilestats-leetify_opening").textContent = opening != null ? (opening > 0 ? `+${opening}` : opening) : "-";

  const preaim = stats["preaim_angle"];
  const reaction = stats["reaction_time"];
  clone.querySelector("#profilestats-leetify_preaim_angle").textContent = preaim != null ? `${preaim}°` : "-";
  clone.querySelector("#profilestats-leetify_reaction_time").textContent = reaction != null ? `${reaction}ms` : "-";

  return premierRating ?? 0;
}

function fillCSStats(clone, csStatsData, steamId64) {
  if (!csStatsData || csStatsData.error) {
    clone.querySelector("#profilestats-csstats_content").textContent =
      csStatsData?.error === "private profile" ? "Profile is private" : "Couldn't load CSStats data";
    return 0;
  }

  const stats = csStatsData["stats"];
  const latestPremier = stats["premier_ratings"]?.[0];
  const premierRating = latestPremier?.["latest_rating"] ?? 0
  const formattedRating = new Intl.NumberFormat("en-US").format(premierRating);

  clone.querySelector("#profilestats-csstats_category_logo_name").href = `https://csstats.gg/player/${steamId64 ?? "-"}`;
  clone.querySelector("#profilestats-csstats_name").textContent = csStatsData["name"];
  clone.querySelector("#profilestats-csstats_premier_rating").textContent = `[${premierRating == null || premierRating === 0 ? "---" : formattedRating}]`

  clone.querySelector("#profilestats-csstats_kd_ratio").textContent = stats["kd_ratio"] ?? "-"
  clone.querySelector("#profilestats-csstats_hltv").textContent = stats["hltv_rating"] ?? "-"
  clone.querySelector("#profilestats-csstats_matches").textContent = stats["matches"] ?? "-"

  const winRate = stats["win_rate"]
  clone.querySelector("#profilestats-csstats_win_rate").textContent = `${winRate ? winRate + "%" : "-"}`

  const hs = stats["hs_percentage"]
  clone.querySelector("#profilestats-csstats_hs_percentage").textContent = hs != null ? `${hs}%` : "-"

  clone.querySelector("#profilestats-csstats_adr").textContent = stats["adr"] ?? "-"

  const clutching = stats["clutch"]
  clone.querySelector("#profilestats-csstats_clutching").textContent = `${clutching ? clutching + "%" : "-"}`

  clone.querySelector("#profilestats-csstats_most_played").textContent = stats["most_played_map"] ?? "-"

  return premierRating ?? 0;
}

function fillFaceit(clone, faceitData, faceitLevels) {
  if (!faceitData || faceitData.error) {
    clone.querySelector("#profilestats-faceit_content").textContent = faceitData?.status === 404 ? "No FaceIt profile" : (faceitData?.error ?? "Couldn't load FaceIt data");
    return 0;
  }

  const stats = faceitData["stats"];
  const faceitLevel = faceitData["level"];
  const ranking = faceitData["ranking"];

  const nickname = faceitData["nickname"];
  clone.querySelector("#profilestats-faceit_category_logo_name").href = `https://www.faceit.com/en/players/${nickname ?? "-"}`;
  clone.querySelector("#profilestats-faceit_level").src = ranking != null && faceitLevel != null ? getFaceitLevelImage(faceitLevels, faceitLevel, ranking) : "";
  if (ranking != null && ranking != 0) {
    clone.querySelector("#profilestats-faceit_level").title = `#${ranking}`
  }
  clone.querySelector("#profilestats-faceit_nickname").textContent = faceitData["nickname"] ?? "-";

  const country = faceitData["country"];
  clone.querySelector("#profilestats-faceit_flag").src = country ? `https://flagsapi.com/${country.toUpperCase()}/flat/24.png` : "";

  clone.querySelector("#profilestats-faceit_membership").textContent = faceitData["membership"] ?? "-";

  const banEl = clone.querySelector("#profilestats-faceit_ban");
  if (faceitData["banned"]) {
    banEl.style.display = "";
    clone.querySelector("#profilestats-faceit_ban_reason").textContent = `Banned for ${faceitData["ban_reason"]?.toLowerCase() ?? "unknown"}`;
  } else {
    banEl.style.display = "none";
  }

  const registered = faceitData["registered"];
  if (registered != null) {
    const { years, months } = howLongAgo(registered);
    clone.querySelector("#profilestats-faceit_registered").textContent = `${years}y, ${months}m ago`;
  } else {
    clone.querySelector("#profilestats-faceit_registered").textContent = "-";
  }

  clone.querySelector("#profilestats-faceit_elo").textContent = faceitData["elo"] ?? "-";
  clone.querySelector("#profilestats-faceit_matches").textContent = stats["matches"] ?? "-";
  clone.querySelector("#profilestats-faceit_kd_ratio").textContent = stats["kd_ratio"] ?? "-";

  const hs = stats["hs_percentage"];
  clone.querySelector("#profilestats-faceit_hs_percentage").textContent = hs != null ? `${hs}%` : "-";

  const winRate = stats["win_rate"];
  clone.querySelector("#profilestats-faceit_win_rate").textContent = winRate != null ? `${winRate}%` : "-";

  clone.querySelector("#profilestats-faceit_avg_kills").textContent = stats["avg_kills"] ?? "-";


  const recentContainer = clone.querySelector("#profilestats-faceit_recent_results");
  const recentResults = stats["recent_results"];
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

  return faceitLevel ?? 0;
}

function createStyles(leetifyPremierRating, csStatsPremierRating, faceitLevel) {
  const leetifyPremierColor = getPremierColor(leetifyPremierRating);
  const csStatsPremierColor = getPremierColor(csStatsPremierRating);
  const faceitColor = getFaceitColor(faceitLevel);
  return `
    .profilestats-customization_header { display: flex; flex-direction: row; justify-content: space-between; }
    .profilestats-button_group { display: flex; gap: 5px; }
    .profilestats-customization_header > button { color: white; background: rgba(0,0,0,0.3); border: none; border-radius: 3px; height: 30px; width: 30px }
    .profilestats-links_button { color: white; background: rgba(0,0,0,0.3); border: none; border-radius: 3px; height: 30px; padding: 0 8px; font-size: 12px; cursor: pointer; display: inline-block; text-decoration: none; line-height: 30px; }
    .profilestats-link_button > div { display: flex; align-items: center; justify-content: center; height: 100%; }
    .profilestats-category_name { color: white; font-size: 23px; font-weight: 600; }
    .profilestats-header { display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding-bottom: 5px; min-height: 40px }
    .profilestats-category_logo_name { display: flex; flex-direction: row; justify-content: start; align-items: center; gap: 10px; }
    .profilestats-category_logo_name:hover { filter: brightness(0.8) }
    .profilestats-category_logo_name > img { height: 27px; }
    .profilestats-header > img { height: 40px; }
    .profilestats-tab { background: none; border: none; color: white; cursor: pointer; }
    .profilestats-tab.active-tab { border-bottom: 1px solid white; margin-bottom: -1px; }
    .profilestats-separator { font-size: 17px; font-weight: bold; }
    .profilestats-ban { display: flex; flex-direction: row; gap: 5px; }
    .profilestats-ban_reason { font-size: 15px; color: red; }
    .profilestats-details { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .profilestats-details > div { color: white; font-size: 17px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: rgba(0,0,0,0.3); border-radius: 3px; padding: 5px; height: fit-content; }
    .profilestats-details > div > span { color: #c4c4c4;font-size: 15px; }
    .profilestats-premier-rating { height: 32px; display: flex; position: relative;}
    .profilestats-premier-rating > span { position: absolute; line-height: 32px; font-size: 18px; font-weight: 700; width: 100%; text-align: center; text-indent: 10px; transform: skew(-10deg, 0deg); }
    #profilestats-steam_profile > div { color: white; font-size: 17px }
    #profilestats-steam_profile > div > span { color: #c4c4c4; font-size: 15px }
    #profilestats-leetify_profile_header { display: flex; flex-direction: row; gap: 10px }
    #profilestats-leetify_name { color: white; font-size: 20px; }
    #profilestats-leetify_premier_rating { color: ${leetifyPremierColor}; }
    #profilestats-csstats_category_name > span { color: #4a7dff}
    #profilestats-csstats_profile_header { display: flex; flex-direction: row; gap: 10px }
    #profilestats-csstats_name { color: white; font-size: 20px; }
    #profilestats-csstats_premier_rating { color: ${csStatsPremierColor}; font-size: 20px; font-weight: 600; }
    .profilestats-details { margin-top: 10px; }
    #profilestats-faceit_profile_header { display: flex; flex-direction: row; align-items: center; gap: 5px }
    #profilestats-faceit_level { color: ${faceitColor}; border-radius: 50%; filter: drop-shadow(${faceitColor}60 0px 0px 5px); }
    #profilestats-faceit_nickname { color: white; font-size: 20px; }
    #profilestats-faceit_elo { color: ${faceitColor}; }
    #profilestats-faceit_recent_results { display: flex; gap: 3px; justify-content: center; }
    .profilestats-settings { display: flex; flex-direction: row; align-items: center; justify-content: end; }
  `;
}

async function setupSettings(el) {
  const saved = await chrome.storage.local.get("profilestats:settings");
  const settings = saved["profilestats:settings"] || { startCollapsed: false };

  const block = el.querySelector(".profile_customization_block");
  const btn = el.querySelector(".profilestats-collapse_button");
  const checkbox = el.querySelector("#profilestats-checkbox-collapsed");

  checkbox.checked = settings.startCollapsed;

  if (settings.startCollapsed) {
    block.style.display = "none";
    btn.textContent = "▼";
  }

  checkbox.addEventListener("change", async () => {
    await chrome.storage.local.set({
      "profilestats:settings": { startCollapsed: checkbox.checked }
    });
  });

  btn.addEventListener("click", () => {
    const isCollapsed = btn.textContent === "▼";
    btn.textContent = isCollapsed ? "▲" : "▼";
    block.style.display = isCollapsed ? "block" : "none";
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

  const images = {
    steamLogo: chrome.runtime.getURL("assets/steam_logo.png"),
    leetifyLogo: chrome.runtime.getURL("assets/leetify_logo.png"),
    leetifyBadge: chrome.runtime.getURL("assets/leetify_badge.png"),
    faceitLogo: chrome.runtime.getURL("assets/faceit_logo.png"),
  };

  const faceitLevels = {
    1: chrome.runtime.getURL("assets/faceit_levels/1.png"),
    2: chrome.runtime.getURL("assets/faceit_levels/2.png"),
    3: chrome.runtime.getURL("assets/faceit_levels/3.png"),
    4: chrome.runtime.getURL("assets/faceit_levels/4.png"),
    5: chrome.runtime.getURL("assets/faceit_levels/5.png"),
    6: chrome.runtime.getURL("assets/faceit_levels/6.png"),
    7: chrome.runtime.getURL("assets/faceit_levels/7.png"),
    8: chrome.runtime.getURL("assets/faceit_levels/8.png"),
    9: chrome.runtime.getURL("assets/faceit_levels/9.png"),
    10: chrome.runtime.getURL("assets/faceit_levels/10.png"),
    challenger: chrome.runtime.getURL("assets/faceit_levels/challenger.png"),
  }

  const premierBgs = {
    grey: chrome.runtime.getURL("assets/premier_ratings/grey.svg"),
    lightblue: chrome.runtime.getURL("assets/premier_ratings/lightblue.svg"),
    blue: chrome.runtime.getURL("assets/premier_ratings/blue.svg"),
    purple: chrome.runtime.getURL("assets/premier_ratings/purple.svg"),
    pink: chrome.runtime.getURL("assets/premier_ratings/pink.svg"),
    red: chrome.runtime.getURL("assets/premier_ratings/red.svg"),
    gold: chrome.runtime.getURL("assets/premier_ratings/gold.svg"),
  };

  const isGamesPrivate = document.querySelector('.profile_recentgame_header') === null;
  const clone = createTemplate(images);

  const steamBackup = clone.querySelector("#profilestats-steam_content").innerHTML;
  const leetifyBackup = clone.querySelector("#profilestats-leetify_content").innerHTML;
  // const csStatsBackup = clone.querySelector("#profilestats-csstats_content").innerHTML;
  const faceitBackup = clone.querySelector("#profilestats-faceit_content").innerHTML;

  const loadingAnimation = `
    <div id="profilestats-loading" style="display: flex; align-items: center">
      <svg style="color: white" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z">
          <animateTransform attributeName="transform" dur="0.75s" repeatCount="indefinite" type="rotate" values="0 12 12;360 12 12"/>
        </path>
      </svg>
    </div>
  `

  clone.querySelector("#profilestats-steam_content").innerHTML = loadingAnimation;
  clone.querySelector("#profilestats-leetify_content").innerHTML = loadingAnimation;
  // clone.querySelector("#profilestats-csstats_content").innerHTML = loadingAnimation;
  clone.querySelector("#profilestats-faceit_content").innerHTML = loadingAnimation;

  const styleEl = document.createElement("style");
  styleEl.textContent = createStyles(0, 0, 0);
  head.appendChild(styleEl);

  el.prepend(clone);
  await setupSettings(el);

  let leetifyPremierRating = 0;
  let faceitLevel = 0;
  let csStatsPremierRating = 0;

  fetchSteamProfile(steamId64).then(steamData => {
    const content = el.querySelector("#profilestats-steam_content");
    content.innerHTML = steamBackup;
    fillSteam(el, steamData, steamId64, isGamesPrivate);
  });

  fetchLeetifyProfile(steamId64).then(leetifyData => {
    const content = el.querySelector("#profilestats-leetify_content");
    content.innerHTML = leetifyBackup;
    leetifyPremierRating = fillLeetify(el, leetifyData, steamId64, premierBgs);
    styleEl.textContent = createStyles(leetifyPremierRating, csStatsPremierRating, faceitLevel);
  });

  // fetchCSStatsProfile(steamId64).then(csStatsData => {
  //   const content = el.querySelector("#profilestats-csstats_content");
  //   content.innerHTML = csStatsBackup;
  //   csStatsPremierRating = fillCSStats(el, csStatsData, steamId64);
  //   styleEl.textContent = createStyles(leetifyPremierRating, csStatsPremierRating, faceitLevel);
  // });

  // faceit is a little more complicated since we have csgo and cs2 to handle
  (async () => {
    const content = el.querySelector("#profilestats-faceit_content");

    const [cs2Data, csgoData] = await Promise.all([
      fetchFaceitProfile(steamId64),
      fetchFaceitCsgoProfile(steamId64),
    ]);

    const csData = { cs2: cs2Data, csgo: csgoData };
    const initialGame = (!cs2Data || cs2Data.error) ? "csgo" : "cs2";

    content.innerHTML = faceitBackup;
    faceitLevel = fillFaceit(el, csData[initialGame], faceitLevels);
    styleEl.textContent = createStyles(leetifyPremierRating, csStatsPremierRating, faceitLevel);

    el.querySelectorAll(".profilestats-tab").forEach(btn => {
      const game = btn.dataset.game;
      const data = csData[game];

      btn.style.display = (!data || data.error) ? "none" : "";
      btn.classList.toggle("active-tab", game === initialGame);

      btn.addEventListener("click", () => {
        el.querySelectorAll(".profilestats-tab").forEach(t => t.classList.remove("active-tab"));
        btn.classList.add("active-tab");
        el.querySelector("#profilestats-faceit_recent_results").innerHTML = "";
        faceitLevel = fillFaceit(el, csData[game], faceitLevels);
        styleEl.textContent = createStyles(leetifyPremierRating, csStatsPremierRating, faceitLevel);
      });
    });
  })();
}

renderStats(
  document.querySelector(".profile_leftcol"),
  document.querySelector("head")
);
