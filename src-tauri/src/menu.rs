use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Result, Wry,
};

const SETTINGS_MENU_ID: &str = "settings";

/// 构建原生菜单栏，并在点击「设置」时向前端发送 `open-settings` 事件。
pub fn setup(app: &mut App<Wry>) -> Result<()> {
    let settings = MenuItemBuilder::with_id(SETTINGS_MENU_ID, "设置…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "Canon 媒体管理器")
            .about(None)
            .separator()
            .item(&settings)
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
            .items(&[&app_menu, &edit_menu, &window_menu])
            .build()?;
        app.set_menu(menu)?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let file_menu = SubmenuBuilder::new(app, "文件")
            .item(&settings)
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
            .items(&[&file_menu, &edit_menu])
            .build()?;
        app.set_menu(menu)?;
    }

    app.on_menu_event(|app, event| {
        if event.id() == SETTINGS_MENU_ID {
            let _ = app.emit("open-settings", ());
        }
    });

    Ok(())
}
