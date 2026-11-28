package main

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"atc/internal/core"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
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
	app := NewApp(core.ConfigDir())
	if app.open = openArg(os.Args[1:]); app.open != "" {
		// Absolute, for the running copy this may be handed to.
		os.Args = []string{os.Args[0], "--open", app.open}
	}
	// One copy per exe: the dev build and the installed one each run their own.
	exe, _ := os.Executable()
	lock := &options.SingleInstanceLock{UniqueId: fmt.Sprintf("atc-%x", sha256.Sum256([]byte(strings.ToLower(exe))))[:20], OnSecondInstanceLaunch: app.secondLaunch}
	// The backdrop is fixed when the window is made, so a change applies from the next launch.
	backdrop := windows.Mica
	if s, _ := core.LoadSettings(filepath.Join(core.ConfigDir(), "settings.json")); core.Str(core.Obj(s["ui"])["backdrop"]) == "acrylic" {
		backdrop = windows.Acrylic
	}
	// scripts/drive.mjs drives the page from headless Edge; the window would only take focus.
	err := wails.Run(&options.App{Title: "ATC — Agent Terminal Control", Width: 1280, Height: 800, MinWidth: 640, MinHeight: 400, StartHidden: os.Getenv("ATC_HIDE_WINDOW") != "", BackgroundColour: &options.RGBA{R: 11, G: 13, B: 16, A: 0}, AssetServer: &assetserver.Options{Assets: assets}, OnStartup: app.startup, OnShutdown: app.shutdown, OnDomReady: func(ctx context.Context) { app.ready(ctx) }, Bind: []interface{}{app}, SingleInstanceLock: lock, Windows: &windows.Options{Theme: windows.Dark, WebviewIsTransparent: true, WindowIsTranslucent: true, BackdropType: backdrop, WebviewUserDataPath: filepath.Join(core.ConfigDir(), "webview-wails"), DisablePinchZoom: true}})
	if err != nil {
		log.Fatal(err)
	}
}
