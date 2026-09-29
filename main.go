package main

import (
	"context"
	"embed"
	"log"
	"path/filepath"

	"atc/internal/core"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:dist
var assets embed.FS

func main() {
	app := NewApp(core.ConfigDir())
	err := wails.Run(&options.App{Title: "ATC — Agent Terminal Control", Width: 1280, Height: 800, MinWidth: 640, MinHeight: 400, BackgroundColour: &options.RGBA{R: 11, G: 13, B: 16, A: 255}, AssetServer: &assetserver.Options{Assets: assets}, OnStartup: app.startup, OnShutdown: app.shutdown, OnDomReady: func(ctx context.Context) { app.ready(ctx) }, Bind: []interface{}{app}, Windows: &windows.Options{Theme: windows.Dark, WebviewUserDataPath: filepath.Join(core.ConfigDir(), "webview-wails"), DisablePinchZoom: true}})
	if err != nil {
		log.Fatal(err)
	}
}
