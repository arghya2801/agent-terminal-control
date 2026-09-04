//! Guards the fixture corpus that every later index test is written against.
//!
//! These assertions are the contract: if someone regenerates `fixtures/claude-projects`
//! and an edge case silently disappears, the parser tests would still pass while no
//! longer testing anything. This fails loudly instead.
//!
//! Regenerate the corpus with `node scripts/make-fixtures.mjs`.

use std::fs;
use std::path::PathBuf;

fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent")
        .join("fixtures")
        .join("claude-projects")
}

/// Session files as the scanner must see them: `*.jsonl` at depth 1 only.
fn session_files(project_dir: &str) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(fixtures_root().join(project_dir))
        .expect("project dir exists")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .filter(|e| e.path().extension().is_some_and(|x| x == "jsonl"))
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    out.sort();
    out
}

#[test]
fn corpus_exists() {
    let root = fixtures_root();
    assert!(
        root.is_dir(),
        "fixture corpus missing at {}; run `node scripts/make-fixtures.mjs`",
        root.display()
    );
}

#[test]
fn subagent_transcripts_are_nested_not_siblings() {
    // The whole point of depth-1 enumeration. game-tracker has 3 real sessions plus a
    // subagent transcript one level down; a recursive walk would report 4.
    let files = session_files("D--Coding-game-tracker-app");
    assert_eq!(files.len(), 3, "expected 3 depth-1 sessions, got {files:?}");

    let nested = fixtures_root()
        .join("D--Coding-game-tracker-app")
        .join("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb")
        .join("subagents")
        .join("agent-explore-1.jsonl");
    assert!(nested.is_file(), "the subagent transcript trap is missing");
}

#[test]
fn mangled_dir_name_disagrees_with_the_real_path() {
    // `D:\Coding\game_tracker_app` mangles to `D--Coding-game-tracker-app`: the
    // underscore is unrecoverable. Any code that decodes the directory name is wrong.
    let head = fs::read_to_string(
        fixtures_root()
            .join("D--Coding-game-tracker-app")
            .join("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jsonl"),
    )
    .unwrap();
    assert!(
        head.contains(r"D:\\Coding\\game_tracker_app"),
        "fixture should record an underscored cwd that the dir name cannot represent"
    );
}

#[test]
fn label_precedence_cases_are_all_present() {
    let root = fixtures_root();
    let read = |p: &str| fs::read_to_string(root.join(p)).unwrap();

    let ai = read("D--Coding-game-tracker-app/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jsonl");
    assert!(ai.contains(r#""type":"ai-title""#), "aiTitle case missing");

    let slug = read("D--Coding-game-tracker-app/bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb.jsonl");
    assert!(!slug.contains("ai-title"), "slug case must have no aiTitle");
    assert!(slug.contains(r#""slug""#), "slug case missing its slug");

    let msg = read("D--Coding-game-tracker-app/cccccccc-3333-4333-8333-cccccccccccc.jsonl");
    assert!(!msg.contains("ai-title") && !msg.contains(r#""slug""#));
    assert!(
        msg.contains(r#""content":[{"type":"text""#),
        "first-message case should use the block-array content shape"
    );

    // "." is too short to be a label; must fall through to the uuid prefix.
    let dot = read("D--Coding-portfolio2/dddddddd-4444-4444-8444-dddddddddddd.jsonl");
    assert!(
        dot.contains(r#""content":".""#),
        "the `.` message case is missing"
    );
}

#[test]
fn first_human_message_sits_past_the_naive_line_budget() {
    // Runs of `file-history-snapshot` push it deep. A 10-line budget must not suffice.
    let body = fs::read_to_string(
        fixtures_root()
            .join("D--Coding-game-tracker-app")
            .join("cccccccc-3333-4333-8333-cccccccccccc.jsonl"),
    )
    .unwrap();
    let line = body
        .lines()
        .position(|l| l.contains("fix the scoreboard sort order"))
        .expect("the deep human message is missing");
    assert!(
        line >= 10,
        "human message at line {line}, too shallow to test the budget"
    );
}

#[test]
fn non_human_turns_are_present_to_be_filtered_out() {
    let body = fs::read_to_string(
        fixtures_root()
            .join("D--Coding-game-tracker-app")
            .join("cccccccc-3333-4333-8333-cccccccccccc.jsonl"),
    )
    .unwrap();
    assert!(
        body.contains("local-command-caveat"),
        "caveat decoy missing"
    );
    assert!(body.contains("command-name"), "slash-command decoy missing");
    assert!(body.contains(r#""isMeta":true"#), "isMeta decoy missing");
}

#[test]
fn truncated_final_line_is_actually_truncated() {
    let body = fs::read_to_string(
        fixtures_root()
            .join("D--Coding-portfolio2")
            .join("eeeeeeee-5555-4555-8555-eeeeeeeeeeee.jsonl"),
    )
    .unwrap();
    let last = body.lines().next_back().expect("has lines");
    assert!(
        serde_json::from_str::<serde_json::Value>(last).is_err(),
        "final line should be unparseable so the parser's quiet-bail path is exercised"
    );
}

#[test]
fn headless_session_exceeds_the_byte_budget_with_no_cwd() {
    const MAX_BYTES: u64 = 512 * 1024;
    let p = fixtures_root()
        .join("D--Coding-headless")
        .join("99999999-7777-4777-8777-999999999999.jsonl");
    let len = fs::metadata(&p).unwrap().len();
    assert!(
        len > MAX_BYTES,
        "headless fixture is {len} bytes; must exceed the {MAX_BYTES}-byte budget"
    );
    assert!(
        !fs::read_to_string(&p).unwrap().contains(r#""cwd""#),
        "headless fixture must never record a cwd"
    );
}

#[test]
fn deleted_project_path_does_not_exist() {
    let body = fs::read_to_string(
        fixtures_root()
            .join("D--Coding-deleted-project")
            .join("ffffffff-6666-4666-8666-ffffffffffff.jsonl"),
    )
    .unwrap();
    assert!(body.contains("deleted_project_xyz"));
    assert!(
        !PathBuf::from(r"D:\Coding\deleted_project_xyz").exists(),
        "the `missing path` fixture only tests anything while that path stays absent"
    );
}

#[test]
fn empty_project_dir_has_no_sessions() {
    assert!(session_files("D--Coding-empty").is_empty());
}
