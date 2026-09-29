// Hides the console window on release builds for Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Emitter, Manager, WebviewWindowBuilder, WebviewUrl};

const PRONOTE_WINDOW_LABEL: &str = "pronote-auth";
const PRONOTE_INFO_MOBILE_ID: &str = "0D264427-EEFC-4810-A9E9-346942A862A4";
const PRONOTE_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";

fn normalize_pronote_base(raw_url: &str) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(raw_url.trim())
        .map_err(|_| "L’adresse Pronote est invalide.".to_string())?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("L’adresse Pronote doit commencer par http:// ou https://.".to_string());
    }

    let path = url.path().trim_end_matches('/');
    if let Some((parent, leaf)) = path.rsplit_once('/') {
        if matches!(leaf.to_ascii_lowercase().as_str(), "eleve.html" | "parent.html" | "professeur.html") {
            url.set_path(if parent.is_empty() { "/" } else { parent });
        }
    }

    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn pronote_initialization_script(info_url: &str, mobile_url: &str, device_uuid: &str) -> Result<String, String> {
    let info_path = tauri::Url::parse(info_url)
        .map_err(|_| "Impossible de préparer la connexion Pronote.".to_string())?
        .path()
        .to_string();
    let info_path = serde_json::to_string(&info_path).map_err(|error| error.to_string())?;
    let mobile_url = serde_json::to_string(mobile_url).map_err(|error| error.to_string())?;
    let device_uuid = serde_json::to_string(device_uuid).map_err(|error| error.to_string())?;

    Ok(format!(
        r#"(() => {{
  const infoPath = {info_path};
  const mobileUrl = {mobile_url};
  const deviceUUID = {device_uuid};
  const report = (kind, data) => {{
    try {{
      const payload = data === undefined ? "" : "?data=" + encodeURIComponent(JSON.stringify(data));
      window.location.replace("scola-pronote://" + kind + payload);
    }} catch (_) {{}}
  }};

  let infoHandled = false;
  let loginReported = false;
  let connectionErrorReported = false;
  let appHookCalled = false;
  let infoChecks = 0;
  const checkPage = () => {{
    const currentPath = window.location.pathname;

    if (!infoHandled && currentPath === infoPath) {{
      infoChecks += 1;
      if (document.body && document.body.innerText) {{
        try {{
          const json = JSON.parse(document.body.innerText);
          const casToken = json && json.CAS && json.CAS.jetonCAS;
          const fiveMinutes = new Date(Date.now() + 5 * 60 * 1000).toUTCString();
          const oneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
          if (casToken) {{
            document.cookie = "appliMobile=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
            document.cookie = "validationAppliMobile=" + casToken + "; expires=" + fiveMinutes;
            document.cookie = "uuidAppliMobile=" + deviceUUID + "; expires=" + fiveMinutes;
          }} else {{
            document.cookie = "appliMobile=1; expires=" + fiveMinutes;
          }}
          document.cookie = "ielang=1036; expires=" + oneYear;
          infoHandled = true;
          window.location.assign(mobileUrl);
          return;
        }} catch (_) {{}}
      }}
      if (infoChecks >= 240) infoHandled = true;
    }}

    if (!appHookCalled && window.GInterface && typeof window.GInterface.passerEnModeValidationAppliMobile === "function") {{
      appHookCalled = true;
      try {{
        window.GInterface.passerEnModeValidationAppliMobile("", deviceUUID, "", "", '{{"model":"Scola","platform":"desktop"}}');
      }} catch (_) {{}}
    }}

    const state = window && window.loginState;
    if (!loginReported && currentPath.toLowerCase().includes("mobile.eleve.html") && state && state.status === 0 && state.login && state.mdp) {{
      loginReported = true;
      report("login-state", state);
      return;
    }}

    if (!connectionErrorReported && document.body && document.body.innerText) {{
      const text = document.body.innerText.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
      if (text.includes("connexion impossible")) {{
        connectionErrorReported = true;
        report("connection-error");
      }}
    }}
  }};

  window.hookAccesDepuisAppli = function() {{
    if (window.GInterface && typeof window.GInterface.passerEnModeValidationAppliMobile === "function") {{
      window.GInterface.passerEnModeValidationAppliMobile("", deviceUUID);
    }}
  }};
  window.setInterval(checkPage, 250);
}})();"#
    ))
}

#[tauri::command(rename_all = "camelCase")]
fn open_pronote_login(app: tauri::AppHandle, url: String, device_uuid: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(PRONOTE_WINDOW_LABEL) {
        existing.close().map_err(|error| error.to_string())?;
    }

    let base_url = normalize_pronote_base(&url)?;
    let base = base_url.as_str().trim_end_matches('/');
    let info_url = format!("{base}/InfoMobileApp.json?id={PRONOTE_INFO_MOBILE_ID}");
    let mobile_url = format!("{base}/mobile.eleve.html?fd=1");
    let script = pronote_initialization_script(&info_url, &mobile_url, &device_uuid)?;
    let initial_url = tauri::Url::parse(&info_url).map_err(|error| error.to_string())?;
    let event_app = app.clone();

    WebviewWindowBuilder::new(
        &app,
        PRONOTE_WINDOW_LABEL,
        WebviewUrl::External(initial_url),
    )
    .title("Connexion à PRONOTE")
    .inner_size(920.0, 760.0)
    .min_inner_size(480.0, 480.0)
    .resizable(true)
    .user_agent(PRONOTE_USER_AGENT)
    .initialization_script(script)
    .on_navigation(move |url| {
        if url.scheme() == "scola-pronote" {
            match url.host_str() {
                Some("login-state") => {
                    if let Some((_, data)) = url.query_pairs().find(|(key, _)| key == "data") {
                        let _ = event_app.emit_to("main", "scola-pronote-login-state", data.into_owned());
                    }
                }
                Some("connection-error") => {
                    let _ = event_app.emit_to("main", "scola-pronote-connection-error", ());
                }
                _ => {}
            }
            return false;
        }

        matches!(url.scheme(), "http" | "https")
    })
    .build()
    .map(|_| ())
    .map_err(|error| format!("Impossible d’ouvrir la fenêtre de connexion PRONOTE : {error}"))
}

#[tauri::command]
fn close_pronote_login(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PRONOTE_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![open_pronote_login, close_pronote_login])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Scola");
}
