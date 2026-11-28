package main

import (
	"crypto/sha256"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"

	"atc/internal/core"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

//go:embed all:dist
var assets embed.FS

//go:embed wails.json
var wailsJSON []byte

// appVersion comes from wails.json, which also stamps the EXE, so a release bumps it once.
var appVersion = func() string {
	var config struct {
		Info struct{ ProductVersion string } `json:"info"`
	}
	_ = json.Unmarshal(wailsJSON, &config)
	return config.Info.ProductVersion
}()

func main() {
	a := NewApp(core.ConfigDir())
	if a.open = openArg(os.Args[1:]); a.open != "" {
		// Absolute, for the running copy this may be handed to.
		os.Args = []string{os.Args[0], "--open", a.open}
	}
	// One copy per exe: the dev build and the installed one each run their own, and each
	// is its own toast sender, so a click reaches the copy that sent it.
	exe, _ := os.Executable()
	id := fmt.Sprintf("atc-%x", sha256.Sum256([]byte(strings.ToLower(exe))))[:20]
	name := "ATC"
	if !strings.EqualFold(filepath.Base(exe), "atc.exe") {
		name = "ATC (" + strings.TrimSuffix(filepath.Base(exe), filepath.Ext(exe)) + ")"
	}
	// The backdrop is fixed when the window is made, so a change applies from the next launch.
	backdrop := application.Mica
	if s, _ := core.LoadSettings(filepath.Join(core.ConfigDir(), "settings.json")); core.Str(core.Obj(s["ui"])["backdrop"]) == "acrylic" {
		backdrop = application.Acrylic
	}
	// The e2e suite attaches WebDriver to the window through this port.
	var browserArgs []string
	if port := os.Getenv("ATC_DEBUG_PORT"); port != "" {
		browserArgs = []string{"--remote-debugging-port=" + port}
	}
	dist, _ := fs.Sub(assets, "dist")
	a.notifier = notifications.New()
	app := application.New(application.Options{
		Name:           name,
		Services:       []application.Service{application.NewService(a), application.NewService(a.notifier)},
		Assets:         application.AssetOptions{Handler: application.AssetFileServerFS(dist)},
		SingleInstance: &application.SingleInstanceOptions{UniqueID: id, OnSecondInstanceLaunch: a.secondLaunch},
		Windows: application.WindowsOptions{
			WebviewUserDataPath:   filepath.Join(core.ConfigDir(), "webview-wails"),
			AdditionalBrowserArgs: browserArgs,
		},
	})
	a.wapp = app
	a.win = app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title: "ATC — Agent Terminal Control", Width: 1280, Height: 800, MinWidth: 640, MinHeight: 400,
		BackgroundType:  application.BackgroundTypeTranslucent,
		DevToolsEnabled: true,
		Windows:         application.WindowsWindow{BackdropType: backdrop, Theme: application.Dark},
	})
	// Closing the last window ends Run without the shutdown hooks (wails#6368); Quit runs them.
	a.win.RegisterHook(events.Common.WindowClosing, func(*application.WindowEvent) { go app.Quit() })
	// A click on a notification brings ATC forward on the tab it came from.
	a.notifier.OnNotificationResponse(func(r notifications.NotificationResult) {
		if r.Error != nil || r.Response.ID == "" {
			return
		}
		a.bringForward()
		a.emit("notification://clicked", r.Response.ID)
	})
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
