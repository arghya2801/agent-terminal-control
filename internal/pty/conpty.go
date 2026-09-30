package pty

import (
	"fmt"
	"os"
	"path/filepath"
	"unsafe"

	"golang.org/x/sys/windows"
)

// Windows Terminal's conpty.dll and OpenConsole.exe, when installed next to atc.exe, replace
// the inbox ConPTY. The inbox one swallows OSC 10/11 colour queries, among others (#116, #81).
var conpty = loadConpty(exeDir())

type conptyProcs struct{ create, resize, close *windows.LazyProc }

func exeDir() string {
	exe, e := os.Executable()
	if e != nil {
		return ""
	}
	return filepath.Dir(exe)
}

// dir must be absolute: a relative one would load a DLL from the working directory.
func loadConpty(dir string) *conptyProcs {
	if !filepath.IsAbs(dir) {
		return nil
	}
	if _, e := os.Stat(filepath.Join(dir, "OpenConsole.exe")); e != nil {
		return nil
	}
	dll := windows.NewLazyDLL(filepath.Join(dir, "conpty.dll"))
	p := &conptyProcs{dll.NewProc("CreatePseudoConsole"), dll.NewProc("ResizePseudoConsole"), dll.NewProc("ClosePseudoConsole")}
	for _, f := range []*windows.LazyProc{p.create, p.resize, p.close} {
		if f.Find() != nil {
			return nil
		}
	}
	return p
}

// BundledConPTY reports whether terminals run on the bundled ConPTY rather than the inbox one.
func BundledConPTY() bool { return conpty != nil }

// A COORD is passed by value, packed into one register.
func packed(c windows.Coord) uintptr { return uintptr(*(*uint32)(unsafe.Pointer(&c))) }

func hresult(r uintptr) error {
	if r != 0 {
		return fmt.Errorf("conpty: HRESULT %#x", uint32(r))
	}
	return nil
}

func createConsole(size windows.Coord, in, out windows.Handle, console *windows.Handle) error {
	if conpty == nil {
		return windows.CreatePseudoConsole(size, in, out, 0, console)
	}
	r, _, _ := conpty.create.Call(packed(size), uintptr(in), uintptr(out), 0, uintptr(unsafe.Pointer(console)))
	return hresult(r)
}

func resizeConsole(console windows.Handle, size windows.Coord) error {
	if conpty == nil {
		return windows.ResizePseudoConsole(console, size)
	}
	r, _, _ := conpty.resize.Call(uintptr(console), packed(size))
	return hresult(r)
}

func releaseConsole(console windows.Handle) {
	if conpty == nil {
		windows.ClosePseudoConsole(console)
		return
	}
	conpty.close.Call(uintptr(console))
}
