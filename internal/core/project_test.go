package core

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// Ported from src-tauri/src/index/project.rs.

func sess(id string, cwd any, mtime int64) Object {
	return Object{"provider": "claude", "id": id, "file": id + ".jsonl", "cwd": cwd, "gitBranch": nil, "label": id, "labelSource": "uuid", "mtimeMs": mtime, "size": int64(1)}
}
func projectsOf(snap Object) []Object {
	out := []Object{}
	for _, p := range Arr(snap["projects"]) {
		out = append(out, Obj(p))
	}
	return out
}
func sessionsOf(p Object) []Object {
	out := []Object{}
	for _, s := range Arr(p["sessions"]) {
		out = append(out, Obj(s))
	}
	return out
}
func pin(path, name string, order int) Object {
	p := Object{"path": path, "order": float64(order)}
	if name != "" {
		p["displayName"] = name
	}
	return p
}

func TestSessionsGroupByProject(t *testing.T) {
	snap := BuildProjects([]Object{sess("a", `D:\Coding\portfolio2`, 10), sess("b", `D:\Coding\portfolio2`, 20), sess("c", `D:\Coding\game_tracker_app`, 5)}, Defaults())
	if len(projectsOf(snap)) != 2 || number(snap["sessionCount"]) != 3 {
		t.Fatal(snap)
	}
}
func TestDifferentSpellingsOfOnePathDoNotSplitAProject(t *testing.T) {
	ps := projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\portfolio2`, 10), sess("b", `d:/coding/portfolio2/`, 20)}, Defaults()))
	if len(ps) != 1 || len(sessionsOf(ps[0])) != 2 {
		t.Fatal(ps)
	}
}
func TestNewestSessionFirstWithinAProject(t *testing.T) {
	p := projectsOf(BuildProjects([]Object{sess("old", `D:\Coding\p`, 10), sess("new", `D:\Coding\p`, 99)}, Defaults()))[0]
	s := sessionsOf(p)
	if s[0]["id"] != "new" || s[1]["id"] != "old" || number(p["lastActiveMs"]) != 99 {
		t.Fatal(p)
	}
}
func TestProjectsSortByMostRecentActivity(t *testing.T) {
	ps := projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\stale`, 10), sess("b", `D:\Coding\fresh`, 900)}, Defaults()))
	if ps[0]["name"] != "fresh" {
		t.Fatal(ps)
	}
}
func TestSessionsWithoutACwdLandInUnknownAndAreNotLaunchable(t *testing.T) {
	ps := projectsOf(BuildProjects([]Object{sess("x", nil, 5)}, Defaults()))
	if len(ps) != 1 || ps[0]["key"] != "\x00unknown" || ps[0]["path"] != nil {
		t.Fatal(ps)
	}
}
func TestUnknownSortsLastEvenWhenMostRecent(t *testing.T) {
	ps := projectsOf(BuildProjects([]Object{sess("x", nil, 9999), sess("a", `D:\Coding\p`, 1)}, Defaults()))
	if ps[len(ps)-1]["key"] != "\x00unknown" {
		t.Fatal(ps)
	}
}
func TestAPinnedProjectLeadsAndCanBeRenamed(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["pinned"] = []any{pin(`D:\Coding\portfolio2`, "Portfolio", 0)}
	ps := projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\portfolio2`, 1), sess("b", `D:\Coding\busy`, 9999)}, s))
	if ps[0]["name"] != "Portfolio" || ps[0]["pinned"] != true || len(sessionsOf(ps[0])) != 1 {
		t.Fatal("pinning must lead, rename, and keep sessions", ps)
	}
}
func TestPinnedOrderIsRespected(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["pinned"] = []any{pin(`D:\Coding\second`, "", 1), pin(`D:\Coding\first`, "", 0)}
	ps := projectsOf(BuildProjects(nil, s))
	if len(ps) != 2 || ps[0]["name"] != "first" || ps[1]["name"] != "second" {
		t.Fatal(ps)
	}
}
func TestAPinnedProjectWithNoSessionsStillAppears(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["pinned"] = []any{pin(`D:\Coding\empty_but_pinned`, "", 0)}
	ps := projectsOf(BuildProjects(nil, s))
	if len(ps) != 1 || len(sessionsOf(ps[0])) != 0 {
		t.Fatal(ps)
	}
}
func TestProjectsWithoutSessionsAreNotInvented(t *testing.T) {
	if ps := projectsOf(BuildProjects(nil, Defaults())); len(ps) != 0 {
		t.Fatal(ps)
	}
}
func TestADeletedProjectDirectoryIsFlaggedNotLaunchable(t *testing.T) {
	ps := projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\deleted_project_xyz`, 1)}, Defaults()))
	if ps[0]["exists"] != false || len(sessionsOf(ps[0])) != 1 {
		t.Fatal("a deleted project must stay listed but not launchable", ps)
	}
}
func TestTheScratchDirectoryIsShownAsScratch(t *testing.T) {
	scratch := filepath.Join(t.TempDir(), "scratch")
	os.MkdirAll(scratch, 0700)
	s := Defaults()
	Obj(s["claude"])["scratchDir"] = scratch
	if n := projectsOf(BuildProjects([]Object{sess("a", scratch, 1)}, s))[0]["name"]; n != "Scratch" {
		t.Fatal(n)
	}
	// An explicit rename still wins over the built-in name.
	Obj(s["projects"])["names"] = Object{scratch: "Questions"}
	if n := projectsOf(BuildProjects([]Object{sess("a", scratch, 1)}, s))[0]["name"]; n != "Questions" {
		t.Fatal(n)
	}
}
func TestARenameBeatsTheDirectoryAndPinnedNames(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["pinned"] = []any{pin(`D:\Coding\portfolio2`, "Pinned", 0)}
	Obj(s["projects"])["names"] = Object{`d:/coding/portfolio2/`: "My Site"}
	if n := projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\portfolio2`, 1)}, s))[0]["name"]; n != "My Site" {
		t.Fatal(n)
	}
}
func TestABlankRenameFallsBack(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["names"] = Object{`D:\Coding\portfolio2`: "  "}
	if n := projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\portfolio2`, 1)}, s))[0]["name"]; n != "portfolio2" {
		t.Fatal(n)
	}
}
func TestASessionRenameReplacesTheLabel(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["sessionNames"] = Object{"a": "auth refactor"}
	got := map[string][]any{}
	for _, x := range sessionsOf(projectsOf(BuildProjects([]Object{sess("a", `D:\Coding\p`, 1), sess("b", `D:\Coding\p`, 2)}, s))[0]) {
		got[Str(x["id"])] = []any{x["label"], x["labelSource"]}
	}
	want := map[string][]any{"a": {"auth refactor", "custom"}, "b": {"b", "uuid"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatal(got)
	}
}
func TestABlankPinnedPathIsIgnored(t *testing.T) {
	s := Defaults()
	Obj(s["projects"])["pinned"] = []any{pin("   ", "", 0)}
	if ps := projectsOf(BuildProjects(nil, s)); len(ps) != 0 {
		t.Fatal(ps)
	}
}
