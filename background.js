chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetch") {
    fetch(message.url)
      .then(res => res.ok ? res.json() : res.json().then(body => ({ error: body?.error || `Error ${res.status}`, status: res.status })))
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }
  if (message.type === "fetchHtml") {
    fetch(message.url)
      .then(res => res.ok ? res.text() : null)
      .then(sendResponse)
      .catch(() => sendResponse(null));
    return true;
  }
});
