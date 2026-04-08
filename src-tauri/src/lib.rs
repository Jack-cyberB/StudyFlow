use std::{fs, sync::Mutex};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};

#[derive(Default)]
struct RuntimeState {
    minimize_to_tray: Mutex<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReminderPolicy {
    mode: String,
    before_minutes: Vec<i64>,
    notify_at_start: bool,
    notify_at_end: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduleEvent {
    id: String,
    title: String,
    subject: String,
    start_time: String,
    end_time: String,
    color: String,
    reminder_policy: ReminderPolicy,
    notes: String,
    enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WeeklyTemplate {
    weekday: i64,
    events: Vec<ScheduleEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DateOverride {
    date: String,
    added_events: Vec<ScheduleEvent>,
    updated_events: Vec<ScheduleEvent>,
    removed_event_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StudySession {
    id: String,
    event_id: String,
    date: String,
    actual_start: String,
    actual_end: Option<String>,
    duration_minutes: i64,
    status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    launch_at_startup: bool,
    minimize_to_tray: bool,
    default_reminder_policy: ReminderPolicy,
    stats_display_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedState {
    schema_version: i64,
    templates: Vec<WeeklyTemplate>,
    overrides: Vec<DateOverride>,
    sessions: Vec<StudySession>,
    settings: AppSettings,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupPayload {
    version: i64,
    exported_at: String,
    payload: PersistedState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StatsExportRow {
    date: String,
    title: String,
    subject: String,
    start_time: String,
    end_time: String,
    planned_minutes: i64,
    actual_minutes: i64,
    status: String,
}

fn default_reminder_policy() -> ReminderPolicy {
    ReminderPolicy {
        mode: "end".into(),
        before_minutes: vec![10],
        notify_at_start: false,
        notify_at_end: true,
    }
}

fn default_settings() -> AppSettings {
    AppSettings {
        launch_at_startup: false,
        minimize_to_tray: true,
        default_reminder_policy: default_reminder_policy(),
        stats_display_mode: "both".into(),
    }
}

fn default_state() -> PersistedState {
    PersistedState {
        schema_version: 1,
        templates: (0..7)
            .map(|weekday| WeeklyTemplate {
                weekday,
                events: Vec::new(),
            })
            .collect(),
        overrides: Vec::new(),
        sessions: Vec::new(),
        settings: default_settings(),
    }
}

fn app_db_path(app: &AppHandle) -> Result<std::path::PathBuf> {
    let base = app.path().app_data_dir().context("missing app data directory")?;
    fs::create_dir_all(&base).context("creating app data directory")?;
    Ok(base.join("studyflow.sqlite"))
}

fn connect(app: &AppHandle) -> Result<Connection> {
    let db_path = app_db_path(app)?;
    let conn = Connection::open(db_path).context("opening sqlite database")?;
    migrate(&conn)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS weekly_templates (
          weekday INTEGER PRIMARY KEY,
          events_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS date_overrides (
          date TEXT PRIMARY KEY,
          added_events_json TEXT NOT NULL,
          updated_events_json TEXT NOT NULL,
          removed_event_ids_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS study_sessions (
          id TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          payload_json TEXT NOT NULL
        );
        "#,
    )
    .context("running migrations")?;

    Ok(())
}

fn load_state_from_db(conn: &Connection) -> Result<PersistedState> {
    let mut state = default_state();

    {
        let mut statement = conn.prepare("SELECT weekday, events_json FROM weekly_templates")?;
        let rows = statement.query_map([], |row| {
            let weekday: i64 = row.get(0)?;
            let events_json: String = row.get(1)?;
            let events: Vec<ScheduleEvent> = serde_json::from_str(&events_json).unwrap_or_default();
            Ok(WeeklyTemplate { weekday, events })
        })?;

        let mut templates = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        templates.sort_by_key(|item| item.weekday);
        if !templates.is_empty() {
            state.templates = templates;
        }
    }

    {
        let mut statement = conn.prepare(
            "SELECT date, added_events_json, updated_events_json, removed_event_ids_json FROM date_overrides",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(DateOverride {
                date: row.get(0)?,
                added_events: serde_json::from_str(&row.get::<_, String>(1)?).unwrap_or_default(),
                updated_events: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or_default(),
                removed_event_ids: serde_json::from_str(&row.get::<_, String>(3)?).unwrap_or_default(),
            })
        })?;

        let mut overrides = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        overrides.sort_by(|left, right| left.date.cmp(&right.date));
        state.overrides = overrides;
    }

    {
        let mut statement = conn.prepare("SELECT payload_json FROM study_sessions")?;
        let rows = statement.query_map([], |row| {
            let payload_json: String = row.get(0)?;
            let session: StudySession =
                serde_json::from_str(&payload_json).unwrap_or_else(|_| StudySession {
                    id: String::new(),
                    event_id: String::new(),
                    date: String::new(),
                    actual_start: String::new(),
                    actual_end: None,
                    duration_minutes: 0,
                    status: "completed".into(),
                });
            Ok(session)
        })?;

        let mut sessions = rows.collect::<std::result::Result<Vec<_>, _>>()?;
        sessions.sort_by(|left, right| left.actual_start.cmp(&right.actual_start));
        state.sessions = sessions;
    }

    let settings_payload: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(payload) = settings_payload {
        state.settings = serde_json::from_str(&payload).unwrap_or_else(|_| default_settings());
    }

    Ok(state)
}

fn persist_state_to_db(conn: &mut Connection, payload: &PersistedState) -> Result<()> {
    let tx = conn.transaction().context("starting transaction")?;
    tx.execute("DELETE FROM weekly_templates", [])?;
    tx.execute("DELETE FROM date_overrides", [])?;
    tx.execute("DELETE FROM study_sessions", [])?;

    for template in &payload.templates {
        tx.execute(
            "INSERT INTO weekly_templates (weekday, events_json) VALUES (?1, ?2)",
            params![template.weekday, serde_json::to_string(&template.events)?],
        )?;
    }

    for date_override in &payload.overrides {
        tx.execute(
            "INSERT INTO date_overrides (date, added_events_json, updated_events_json, removed_event_ids_json) VALUES (?1, ?2, ?3, ?4)",
            params![
                date_override.date,
                serde_json::to_string(&date_override.added_events)?,
                serde_json::to_string(&date_override.updated_events)?,
                serde_json::to_string(&date_override.removed_event_ids)?
            ],
        )?;
    }

    for session in &payload.sessions {
        tx.execute(
            "INSERT INTO study_sessions (id, payload_json) VALUES (?1, ?2)",
            params![session.id, serde_json::to_string(session)?],
        )?;
    }

    tx.execute(
        "INSERT INTO app_settings (id, payload_json) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json",
        params![serde_json::to_string(&payload.settings)?],
    )?;

    tx.commit().context("committing transaction")?;
    Ok(())
}

fn update_runtime_preferences(runtime: &State<RuntimeState>, payload: &PersistedState) {
    if let Ok(mut minimize_to_tray) = runtime.minimize_to_tray.lock() {
        *minimize_to_tray = payload.settings.minimize_to_tray;
    }
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn read_backup_payload(raw: &str) -> Result<PersistedState> {
    if let Ok(backup) = serde_json::from_str::<BackupPayload>(raw) {
        return Ok(backup.payload);
    }

    let payload = serde_json::from_str::<PersistedState>(raw).context("parsing backup payload")?;
    Ok(payload)
}

#[tauri::command]
fn load_state(app: AppHandle) -> Result<PersistedState, String> {
    let conn = connect(&app).map_err(|error| error.to_string())?;
    load_state_from_db(&conn).map_err(|error| error.to_string())
}

#[tauri::command]
fn persist_state(
    app: AppHandle,
    runtime: State<RuntimeState>,
    payload: PersistedState,
) -> Result<(), String> {
    let mut conn = connect(&app).map_err(|error| error.to_string())?;
    persist_state_to_db(&mut conn, &payload).map_err(|error| error.to_string())?;
    update_runtime_preferences(&runtime, &payload);
    Ok(())
}

#[tauri::command]
fn export_backup(file_path: String, payload: PersistedState) -> Result<String, String> {
    let backup = BackupPayload {
        version: payload.schema_version,
        exported_at: Utc::now().to_rfc3339(),
        payload,
    };
    let json = serde_json::to_string_pretty(&backup).map_err(|error| error.to_string())?;
    fs::write(&file_path, json).map_err(|error| error.to_string())?;
    Ok(file_path)
}

#[tauri::command]
fn import_backup(
    app: AppHandle,
    runtime: State<RuntimeState>,
    file_path: String,
) -> Result<PersistedState, String> {
    let raw = fs::read_to_string(&file_path).map_err(|error| error.to_string())?;
    let payload = read_backup_payload(&raw).map_err(|error| error.to_string())?;
    let mut conn = connect(&app).map_err(|error| error.to_string())?;
    persist_state_to_db(&mut conn, &payload).map_err(|error| error.to_string())?;
    update_runtime_preferences(&runtime, &payload);
    Ok(payload)
}

#[tauri::command]
fn export_csv(file_path: String, rows: Vec<StatsExportRow>) -> Result<String, String> {
    let mut writer = csv::Writer::from_path(&file_path).map_err(|error| error.to_string())?;
    writer
        .write_record([
            "date",
            "title",
            "subject",
            "startTime",
            "endTime",
            "plannedMinutes",
            "actualMinutes",
            "status",
        ])
        .map_err(|error| error.to_string())?;

    for row in rows {
        writer
            .write_record([
                row.date,
                row.title,
                row.subject,
                row.start_time,
                row.end_time,
                row.planned_minutes.to_string(),
                row.actual_minutes.to_string(),
                row.status,
            ])
            .map_err(|error| error.to_string())?;
    }

    writer.flush().map_err(|error| error.to_string())?;
    Ok(file_path)
}

pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let conn = connect(&app.handle())?;
            let payload = load_state_from_db(&conn)?;
            update_runtime_preferences(&app.state::<RuntimeState>(), &payload);

            let menu = MenuBuilder::new(app)
                .text("open_today", "打开今日页")
                .text("toggle_notifications", "暂停通知")
                .separator()
                .text("quit", "退出")
                .build()?;

            let app_handle = app.handle().clone();
            TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon(app.default_window_icon().cloned().context("missing app icon")?)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open_today" => {
                        show_main_window(app);
                        let _ = app.emit("tray-open-today", ());
                    }
                    "toggle_notifications" => {
                        let _ = app.emit("tray-toggle-notifications", ());
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&app_handle);
                        let _ = app_handle.emit("tray-open-today", ());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            persist_state,
            export_backup,
            import_backup,
            export_csv
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let runtime = window.state::<RuntimeState>();
                let minimize_to_tray = runtime
                    .minimize_to_tray
                    .lock()
                    .map(|value| *value)
                    .unwrap_or(true);

                if minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
