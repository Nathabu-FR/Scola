// Hides the console window on release builds for Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
    Emitter, Manager, State, WebviewWindowBuilder, WebviewUrl, WindowEvent,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    process::Command,
    sync::atomic::{AtomicBool, Ordering},
};

const PRONOTE_WINDOW_LABEL: &str = "pronote-auth";
const PRONOTE_INFO_MOBILE_ID: &str = "0D264427-EEFC-4810-A9E9-346942A862A4";
const PRONOTE_USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36";
const RELEASE_API_URL: &str = "https://api.github.com/repos/PapillonApp/Papillon/releases/latest";
const STARTUP_REGISTRY_KEY: &str = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const STARTUP_REGISTRY_VALUE: &str = "Scola";

struct DesktopBehavior {
    close_to_tray: AtomicBool,
}

impl Default for DesktopBehavior {
    fn default() -> Self {
        Self { close_to_tray: AtomicBool::new(true) }
    }
}

#[derive(Deserialize)]
struct GitHubRelease {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<GitHubReleaseAsset>,
}

#[derive(Deserialize)]
struct GitHubReleaseAsset {
    name: String,
    browser_download_url: String,
    digest: Option<String>,
    size: u64,
}

#[tauri::command(rename_all = "camelCase")]
fn configure_desktop_preferences(
    close_to_tray: bool,
    launch_at_startup: bool,
    launch_in_background: bool,
    behavior: State<'_, DesktopBehavior>,
) -> Result<(), String> {
    behavior.close_to_tray.store(close_to_tray, Ordering::SeqCst);
    configure_windows_startup(launch_at_startup, launch_in_background)
}

#[cfg(target_os = "windows")]
fn configure_windows_startup(enabled: bool, launch_in_background: bool) -> Result<(), String> {
    if !enabled {
        // A missing Run value is already the desired state.
        let _ = Command::new("reg.exe")
            .args(["delete", STARTUP_REGISTRY_KEY, "/v", STARTUP_REGISTRY_VALUE, "/f"])
            .output();
        return Ok(());
    }

    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut command = format!("\"{}\"", executable.display());
    if launch_in_background {
        command.push_str(" --scola-background");
    }
    let output = Command::new("reg.exe")
        .arg("add")
        .arg(STARTUP_REGISTRY_KEY)
        .arg("/v")
        .arg(STARTUP_REGISTRY_VALUE)
        .arg("/t")
        .arg("REG_SZ")
        .arg("/d")
        .arg(&command)
        .arg("/f")
        .output()
        .map_err(|error| format!("Impossible de configurer le démarrage Windows : {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Windows n’a pas accepté le démarrage automatique : {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn configure_windows_startup(_enabled: bool, _launch_in_background: bool) -> Result<(), String> {
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
async fn install_latest_update(app: tauri::AppHandle, expected_version: String) -> Result<(), String> {
    if !expected_version.chars().all(|character| character.is_ascii_digit() || character == '.') {
        return Err("Numéro de version invalide.".to_string());
    }

    let release: GitHubRelease = reqwest::Client::new()
        .get(RELEASE_API_URL)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .header("User-Agent", "Scola-Updater")
        .send().await.map_err(|error| format!("Connexion à GitHub impossible : {error}"))?
        .error_for_status().map_err(|error| format!("GitHub n’a pas fourni la mise à jour : {error}"))?
        .json().await.map_err(|error| format!("Réponse de version illisible : {error}"))?;

    if release.draft || release.prerelease || release.tag_name != format!("v{expected_version}") {
        return Err("La version disponible a changé. Relance la recherche de mises à jour.".to_string());
    }

    let asset = release.assets.iter().find(|asset| asset.name.to_ascii_lowercase().ends_with(".exe"))
        .ok_or_else(|| "L’installateur Windows est introuvable dans cette version.".to_string())?;
    if asset.size > 350 * 1024 * 1024 {
        return Err("La taille de l’installateur dépasse la limite autorisée.".to_string());
    }
    let expected_digest = asset.digest.as_deref()
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .ok_or_else(|| "GitHub n’a pas fourni l’empreinte de l’installateur.".to_string())?;
    let download_url = tauri::Url::parse(&asset.browser_download_url)
        .map_err(|_| "L’adresse de téléchargement est invalide.".to_string())?;
    if download_url.scheme() != "https" || download_url.host_str() != Some("github.com") {
        return Err("L’adresse de téléchargement n’est pas sécurisée.".to_string());
    }

    let bytes = reqwest::Client::new()
        .get(download_url)
        .header("User-Agent", "Scola-Updater")
        .send().await.map_err(|error| format!("Téléchargement impossible : {error}"))?
        .error_for_status().map_err(|error| format!("Le téléchargement a échoué : {error}"))?
        .bytes().await.map_err(|error| format!("Installateur incomplet : {error}"))?;
    if bytes.len() as u64 != asset.size || bytes.len() > 350 * 1024 * 1024 {
        return Err("La taille du fichier reçu ne correspond pas à l’installateur.".to_string());
    }
    let actual_digest = format!("{:x}", Sha256::digest(&bytes));
    if !actual_digest.eq_ignore_ascii_case(expected_digest) {
        return Err("L’empreinte de l’installateur ne correspond pas à celle publiée par GitHub.".to_string());
    }

    let current_executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let temporary_directory = std::env::temp_dir();
    let installer_path = temporary_directory.join(format!("Scola-update-{}.exe", std::process::id()));
    let script_path = temporary_directory.join(format!("Scola-update-{}.ps1", std::process::id()));
    fs::write(&installer_path, &bytes).map_err(|error| format!("Impossible d’enregistrer l’installateur : {error}"))?;

    let installer_literal = powershell_literal(&installer_path.to_string_lossy());
    let application_literal = powershell_literal(&current_executable.to_string_lossy());
    let script = format!(
        "$ErrorActionPreference='Stop'\n$process = Get-Process -Id {} -ErrorAction SilentlyContinue\nif ($process) {{ $process.WaitForExit() }}\ntry {{ Start-Process -FilePath {} -ArgumentList '/S' -Wait | Out-Null }} finally {{ Start-Process -FilePath {} }}\nRemove-Item -LiteralPath {} -Force -ErrorAction SilentlyContinue\nRemove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue\n",
        std::process::id(), installer_literal, application_literal, installer_literal
    );
    fs::write(&script_path, script).map_err(|error| format!("Impossible de préparer l’installation : {error}"))?;

    let mut command = Command::new("powershell.exe");
    command.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File"])
        .arg(&script_path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command.spawn().map_err(|error| format!("Impossible de démarrer l’installation : {error}"))?;
    app.exit(0);
    Ok(())
}

fn powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn normalize_pronote_base(raw_url: &str) -> Result<tauri::Url, String> {
    let mut url = tauri::Url::parse(raw_url.trim())
        .map_err(|_| "L’adresse Pronote est invalide.".to_string())?;

    if !matches!(url.scheme(), "http" | "https") {
        return Err("L’adresse Pronote doit commencer par http:// ou https://.".to_string());
    }

    let path = url.path().trim_end_matches('/').to_string();
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
      if (infoChecks >= 240) {{
        infoHandled = true;
        report("connection-error", {{ message: "La page mobile de PRONOTE n’a pas répondu après 60 secondes." }});
      }}
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
        report("connection-error", {{ message: "L’ENT a refusé ou interrompu la connexion PRONOTE." }});
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
async fn open_pronote_login(app: tauri::AppHandle, url: String, device_uuid: String) -> Result<(), String> {
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
    let popup_app = app.clone();

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
    // PRONOTE/ENT opens some identity-provider pages with window.open.
    // Match the former React Native WebView flow: reuse this authenticated
    // WebView for the popup URL so its redirect reaches the login hook.
    .on_new_window(move |url, _features| {
        if matches!(url.scheme(), "http" | "https") {
            if let Some(window) = popup_app.get_webview_window(PRONOTE_WINDOW_LABEL) {
                let _ = window.navigate(url);
            }
        }
        NewWindowResponse::Deny
    })
    .on_navigation(move |url| {
        if url.scheme() == "scola-pronote" {
            match url.host_str() {
                Some("login-state") => {
                    if let Some((_, data)) = url.query_pairs().find(|(key, _)| key == "data") {
                        let _ = event_app.emit_to("main", "scola-pronote-login-state", data.into_owned());
                    }
                }
                Some("connection-error") => {
                    let detail = url.query_pairs()
                        .find(|(key, _)| key == "data")
                        .map(|(_, value)| value.into_owned())
                        .unwrap_or_default();
                    let _ = event_app.emit_to("main", "scola-pronote-connection-error", detail);
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

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .manage(DesktopBehavior::default())
        .invoke_handler(tauri::generate_handler![
            open_pronote_login,
            close_pronote_login,
            configure_desktop_preferences,
            install_latest_update,
        ])
        .setup(|app| {
            let open_item = MenuItem::with_id(app, "open", "Ouvrir Scola", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter Scola", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            let tray = TrayIconBuilder::with_id("scola-tray")
                .tooltip("Scola reste active en arrière-plan")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(
                        event,
                        TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        }
                    ) {
                        show_main_window(tray.app_handle());
                    }
                });

            let tray = if let Some(icon) = app.default_window_icon() {
                tray.icon(icon.clone())
            } else {
                tray
            };
            tray.build(app)?;
            if std::env::args().any(|argument| argument == "--scola-background") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.app_handle().state::<DesktopBehavior>().close_to_tray.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Scola");
}
