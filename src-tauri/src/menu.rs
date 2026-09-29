use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Result, Wry,
};

const SETTINGS_MENU_ID: &str = "settings";
const CHECK_UPDATE_MENU_ID: &str = "check-update";
const EXPORT_MENU_ID: &str = "export-card";
const SYNC_MENU_ID: &str = "sync-folder";

/// 构建原生菜单栏，并在点击菜单项时向前端发送对应事件。
pub fn setup(app: &mut App<Wry>) -> Result<()> {
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "设置…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_update = MenuItemBuilder::with_id(CHECK_UPDATE_MENU_ID, "检查更新…").build(app)?;
    let export_item = MenuItemBuilder::with_id(EXPORT_MENU_ID, "从存储卡导出…")
        .accelerator("CmdOrCtrl+E")
        .build(app)?;
    let sync_item = MenuItemBuilder::with_id(SYNC_MENU_ID, "同步到备份盘…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;

    let tools_menu = SubmenuBuilder::new(app, "工具")
        .item(&export_item)
        .item(&sync_item)
        .build()?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "Canon 媒体管理器")
            .about(None)
            .separator()
            .item(&settings)
            .item(&check_update)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;

        let edit_menu = SubmenuBuilder::new(app, "编辑")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;

        let window_menu = SubmenuBuilder::new(app, "窗口")
            .minimize()
            .maximize()
            .separator()
            .close_window()
            .build()?;

        let menu = MenuBuilder::new(app)
            .items(&[&app_menu, &edit_menu, &tools_menu, &window_menu])
            .build()?;
        app.set_menu(menu)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let file_menu = SubmenuBuilder::new(app, "文件")
            .item(&settings)
            .item(&check_update)
            .separator()
            .quit()
            .build()?;

        let edit_menu = SubmenuBuilder::new(app, "编辑")
            .undo()
            .redo()
            .separator()
            .cut()
            .copy()
            .paste()
            .select_all()
            .build()?;

        let menu = MenuBuilder::new(app)
            .items(&[&file_menu, &edit_menu, &tools_menu])
            .build()?;
        app.set_menu(menu)?;
    }

    app.on_menu_event(|app, event| {
        if event.id() == SETTINGS_MENU_ID {
            let _ = app.emit("open-settings", ());
        } else if event.id() == CHECK_UPDATE_MENU_ID {
            let _ = app.emit("check-update", ());
        } else if event.id() == EXPORT_MENU_ID {
            let _ = app.emit("open-export", ());
        } else if event.id() == SYNC_MENU_ID {
            let _ = app.emit("open-sync", ());
        }
    });

    Ok(())
}
