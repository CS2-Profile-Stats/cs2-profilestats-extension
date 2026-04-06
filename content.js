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
  return cachedFetch(`faceit:${steamId64}`, () =>
    backgroundFetch(`${API_URL}/api/stats/faceit/${steamId64}`)
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
  if (rating < 5000)  return "#c4cce2";
  if (rating < 10000) return "#85b9eb";
  if (rating < 15000) return "#4c64fe";
  if (rating < 20000) return "#bf62f9";
  if (rating < 25000) return "#ee05fb";
  if (rating < 30000) return "#fe292d";
  if (rating >= 30000) return "#fbde08";
  return "#c4cce2";
}

function getFaceitColor(level) {
  if (level === 1) return "#dddddd";
  if (level === 2 || level === 3) return "#47e66e";
  if (level >= 4 && level <= 7) return "#fecd23";
  if (level === 8 || level === 9) return "#fd6c1e";
  if (level === 10) return "#e80026";
  return "#dddddd";
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
        CS2 Profile Stats
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
                <span id="profilestats-leetify_premier_rating"></span>
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
        <div class="showcase_content_bg profilestats-faceit">
          <div class="profilestats-header">
            <a class="profilestats-category_logo_name" id="profilestats-faceit_category_logo_name">
              <img src="${faceitLogo}"/>
              <div class="profilestats-category_name">FaceIt</div>
            </a>
          </div>
          <div id="profilestats-faceit_content">
            <div id="profilestats-faceit_profile">
              <div id="profilestats-faceit_profile_header">
                <span id="profilestats-faceit_level"></span>
                <img id="profilestats-faceit_flag"/>
                <span id="profilestats-faceit_nickname"></span>
                <span style="font-size: 17px; font-weight: bold"> | </span>
                <div style="font-size: 17px">Faceit <span id="profilestats-faceit_membership"></span></div>
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

function fillLeetify(clone, leetifyData, steamId64) {
  if (!leetifyData || leetifyData.error) {
    clone.querySelector("#profilestats-leetify_content").textContent = "Couldn't load Leetify data"
    return 0;
  }

  const stats = leetifyData["stats"];
  const premierRating = stats["premier_rating"];
  const formattedRating = new Intl.NumberFormat("en-US").format(premierRating);

  clone.querySelector("#profilestats-leetify_category_logo_name").href = `https://leetify.com/app/profile/${steamId64}`;
  clone.querySelector("#profilestats-leetify_name").textContent = `${leetifyData["name"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_premier_rating").textContent = `[${premierRating == null || premierRating === 0 ? "---" : formattedRating}]`
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
  clone.querySelector("#profilestats-leetify_win_rate").textContent = `${winRate == null ? "-" : winRate + "%"}`;
  clone.querySelector("#profilestats-leetify_aim_rating").textContent = `${stats["aim_rating"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_positioning").textContent = `${stats["positioning"] ?? "-"}`;
  clone.querySelector("#profilestats-leetify_utility").textContent = `${stats["utility"] ?? "-"}`;

  const clutching = stats["clutching"];
  clone.querySelector("#profilestats-leetify_clutching").textContent = clutching == null ? "-" : (clutching > 0 ? `+${clutching}` : clutching);

  const opening = stats["opening"];
  clone.querySelector("#profilestats-leetify_opening").textContent = opening == null ? "-" : (opening > 0 ? `+${opening}` : opening);

  const preaim = stats["preaim_angle"]
  const reaction = stats["reaction_time"]
  clone.querySelector("#profilestats-leetify_preaim_angle").textContent = `${preaim == null ? "-" : preaim + "°"}`;
  clone.querySelector("#profilestats-leetify_reaction_time").textContent = `${reaction == null ? "-" : reaction + "ms"}`;

  return premierRating ?? 0;
}

function fillFaceit(clone, faceitData) {
  if (!faceitData || faceitData.error) {
    clone.querySelector("#profilestats-faceit_content").textContent = faceitData?.status === 404 ? "No FaceIt profile" : (faceitData?.error ?? "Couldn't load FaceIt data");
    return 0;
  }

  const stats = faceitData["stats"];
  const faceitLevel = faceitData["level"];
  const ranking = faceitData["ranking"];
  const displayLevel = ranking != null && ranking <= 1000 && ranking !== 0 ? `#${ranking}` : (faceitLevel ?? "?");

  const nickname = faceitData["nickname"];
  clone.querySelector("#profilestats-faceit_category_logo_name").href = `https://www.faceit.com/en/players/${nickname ?? ""}`;
  clone.querySelector("#profilestats-faceit_level").textContent = displayLevel;
  clone.querySelector("#profilestats-faceit_nickname").textContent = faceitData["nickname"] ?? "-";

  const country = faceitData["country"];
  clone.querySelector("#profilestats-faceit_flag").src = country ? `https://flagsapi.com/${country.toUpperCase()}/flat/24.png` : "";

  clone.querySelector("#profilestats-faceit_membership").textContent = faceitData["membership"] ?? "-";

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

function createStyles(premierRating, faceitLevel) {
  const premierColor = getPremierColor(premierRating);
  const faceitColor = getFaceitColor(faceitLevel);

  return `
    <style>
      .profilestats-customization_header { display: flex; flex-direction: row; justify-content: space-between; }
      .profilestats-customization_header > button { color: white; background: rgba(0,0,0,0.3); border: none; border-radius: 3px; height: 30px; width: 30px }
      .profilestats-category_name { color: white; font-size: 23px; font-weight: 600; }
      .profilestats-header { display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding-bottom: 5px; min-height: 40px }
      .profilestats-category_logo_name { display: flex; flex-direction: row; justify-content: start; align-items: center; gap: 10px; }
      .profilestats-category_logo_name:hover { filter: brightness(0.8) }
      .profilestats-category_logo_name > img { height: 27px; }
      .profilestats-header > img { height: 40px; }
      .profilestats-details { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .profilestats-details > div { color: white; font-size: 17px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; background: rgba(0,0,0,0.3); border-radius: 3px; padding: 5px; height: fit-content; }
      .profilestats-details > div > span { color: #c4c4c4;font-size: 15px; }
      #profilestats-steam_profile > div { color: white; font-size: 17px }
      #profilestats-steam_profile > div > span { color: #c4c4c4; font-size: 15px }
      #profilestats-leetify_profile_header { display: flex; flex-direction: row; gap: 10px }
      #profilestats-leetify_name { color: white; font-size: 20px; }
      #profilestats-leetify_premier_rating { color: ${premierColor}; font-size: 20px; font-weight: 600; }
      .profilestats-details { margin-top: 10px; }
      #profilestats-faceit_profile_header { display: flex; flex-direction: row; align-items: center; gap: 5px }
      #profilestats-faceit_level { color: ${faceitColor}; font-weight: bold; font-size: 15px; border: 2px solid ${faceitColor}; border-radius: 50%; min-height: 30px; aspect-ratio: 1; display: flex; align-items: center; justify-content: center }
      #profilestats-faceit_nickname { color: white; font-size: 20px; }
      #profilestats-faceit_elo { color: ${faceitColor}; }
      #profilestats-faceit_recent_results { display: flex; gap: 3px; justify-content: center; }
      .profilestats-settings { display: flex; flex-direction: row; align-items: center; justify-content: end; }
    </style>
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

  console.log(steamId64)

  const [faceitData, leetifyData, steamData] = await Promise.all([
    fetchFaceitProfile(steamId64),
    fetchLeetifyProfile(steamId64),
    fetchSteamProfile(steamId64)
  ]);

  // is api down
  if (!faceitData && !leetifyData && !steamData) return;

  console.log(faceitData);
  console.log(leetifyData);
  console.log(steamData);

  const images = {
    steamLogo:   chrome.runtime.getURL("assets/steam_logo.png"),
    leetifyLogo: chrome.runtime.getURL("assets/leetify_logo.png"),
    leetifyBadge: chrome.runtime.getURL("assets/leetify_badge.png"),
    faceitLogo:  chrome.runtime.getURL("assets/faceit_logo.png"),
  };

  const isGamesPrivate = document.querySelector('.profile_recentgame_header') === null
  const clone = createTemplate(images);

  fillSteam(clone, steamData, steamId64, isGamesPrivate);
  const premierRating = fillLeetify(clone, leetifyData, steamId64);
  const faceitLevel = fillFaceit(clone, faceitData);

  head.insertAdjacentHTML("beforeend", createStyles(premierRating, faceitLevel));
  el.prepend(clone);

  await setupSettings(el);
}

renderStats(
  document.querySelector(".profile_leftcol"),
  document.querySelector("head")
);
