/**
 * The human-facing companion to `tools.ts`.
 *
 * `tools.ts` is what the model reads; this is what a person reads. Descriptions
 * and confirmation flags are NOT duplicated here -- the page renders those
 * straight from the catalog, so a tool whose behaviour changes cannot end up
 * documented as its old self. What lives here is the part a catalog cannot
 * supply: the sentence someone would actually type, and what they get back.
 *
 * The completeness check at the bottom fails the build rather than the page.
 * A capability that ships undocumented is a capability nobody discovers.
 */

import { TOOLS } from "./tools";

export interface ToolGuide {
  /** What a person would actually say. Rendered as a copyable prompt. */
  prompt: string;
  /** Plain-language gloss of what comes back, or what visibly happens. */
  result: string;
}

export const TOOL_GUIDE: Record<string, ToolGuide> = {
  // ---------- Ask ----------
  list_processes: {
    prompt: "What's using my CPU right now?",
    result:
      "A ranked list of running programs with their CPU and memory use, and the process id for each — which is what lets a follow-up like “close that one” find its target.",
  },
  list_windows: {
    prompt: "What have I got open?",
    result:
      "Every open window with its title and owning program, foreground first, flagged if minimized.",
  },
  read_window_text: {
    prompt: "What does the export dialog say?",
    result:
      "The readable text inside that window — progress lines, dialog messages, status bars. Some programs draw their interface without exposing any text, and those come back empty rather than guessed at.",
  },
  list_folder: {
    prompt: "What's in my Downloads folder?",
    result:
      "Names, sizes and dates, with half-finished downloads marked as such.",
  },
  find_files: {
    prompt: "Where did I save that invoice PDF?",
    result:
      "Matching files and folders across your Documents, Downloads, Desktop, Pictures and Videos, newest first. The search is time-bounded, so it will tell you when it stopped early rather than pretend it saw everything.",
  },
  get_system_stats: {
    prompt: "How much disk space have I got left?",
    result:
      "CPU load, memory in use, free space per drive, battery state, and how long the machine has been up.",
  },
  get_download_status: {
    prompt: "Is my download finished yet?",
    result:
      "Whether anything is still downloading. It watches the files grow for two seconds, so it can tell a download that is still running from one that has stalled — which a plain folder listing cannot.",
  },
  get_volume: {
    prompt: "How loud is my PC set right now?",
    result: "The current output level and whether it is muted.",
  },
  list_apps: {
    prompt: "What apps are installed on this PC?",
    result:
      "The programs in your Start Menu. Shells, terminals and language interpreters are deliberately left out and will not appear.",
  },

  // ---------- Act ----------
  focus_window: {
    prompt: "Bring Chrome to the front",
    result: "That window comes forward, and is un-minimized first if it needs to be.",
  },
  minimize_window: {
    prompt: "Minimize Spotify",
    result: "The window drops to the taskbar.",
  },
  maximize_window: {
    prompt: "Maximize the browser",
    result: "The window fills the screen.",
  },
  restore_window: {
    prompt: "Put that window back to its normal size",
    result:
      "The window returns to the size and position it had before it was minimized or maximized.",
  },
  open_path: {
    prompt: "Open my Downloads folder",
    result:
      "The file or folder opens in whatever program normally handles it. Only your Downloads, Documents, Desktop, Pictures and Videos folders can be reached this way.",
  },
  launch_app: {
    prompt: "Open Spotify",
    result:
      "The program starts. It can only start something that appeared in the installed-apps list, and it is given a name from that list rather than a path — so nothing outside it can be reached.",
  },
  set_volume: {
    prompt: "Set the volume to 30%",
    result: "The output level changes. Ask for “a bit quieter” and it reads the current level first.",
  },
  set_mute: {
    prompt: "Mute my PC",
    result:
      "Sound is silenced without losing the level, so unmuting brings it back where it was.",
  },
  media_key: {
    prompt: "Pause the music",
    result:
      "Play, pause, skip and previous reach whatever is playing — no need to find or focus the player first, and it works while it is minimized.",
  },
  close_window: {
    prompt: "Close Notepad",
    result:
      "The program is asked to close and may prompt you to save. It is a request, not a kill: unsaved work is never discarded on your behalf.",
  },
  kill_process: {
    prompt: "Force-quit Chrome, it's frozen",
    result:
      "The program is terminated outright and unsaved work in it is lost — which is why it asks first. Processes Windows depends on are refused no matter who asks.",
  },
  lock_workstation: {
    prompt: "Lock my PC",
    result:
      "The machine locks. Note that the agent cannot see or reach the lock screen afterwards, so live view and window tools go quiet until you sign back in.",
  },
};

/**
 * The interesting behaviour is not any single tool — it is the model choosing a
 * read to find a target and then acting on that specific target. These are the
 * examples that show it doing so.
 */
export interface ChainedExample {
  prompt: string;
  steps: string[];
  note: string;
}

export const CHAINED_EXAMPLES: ChainedExample[] = [
  {
    prompt: "Chrome is eating my CPU, sort it out",
    steps: ["list_processes", "kill_process"],
    note: "It looks first, reports what it found, and only then asks to end that specific process. It never guesses a process id.",
  },
  {
    prompt: "Is my download done? If it is, open the folder",
    steps: ["get_download_status", "open_path"],
    note: "One question, two tools, and the second only runs if the answer to the first was yes.",
  },
  {
    prompt: "Find my CV and open it",
    steps: ["find_files", "open_path"],
    note: "Search returns a real path, which is then opened — so you never have to know where you filed it.",
  },
  {
    prompt: "Turn it down a bit",
    steps: ["get_volume", "set_volume"],
    note: "“A bit” is only meaningful relative to the current level, so it reads before it writes.",
  },
  {
    prompt: "What's that dialog on screen asking me?",
    steps: ["list_windows", "read_window_text"],
    note: "It finds the foreground window, then reads its text — without a screenshot, and without any image leaving your PC.",
  },
];

/** Watch rules are configured from the device panel, not asked for in chat. */
export interface WatchGuide {
  label: string;
  fires: string;
}

export const WATCH_GUIDE: WatchGuide[] = [
  { label: "Disk space low", fires: "A drive drops below the free-space threshold you set." },
  { label: "Program closed", fires: "A program you named stops running — the usual way to be told a long render or export has finished." },
  { label: "Program started", fires: "A program you named starts running." },
  { label: "CPU pegged", fires: "CPU stays above your threshold long enough to mean something is wrong." },
  { label: "Download finished", fires: "The in-progress downloads in a folder all complete." },
  { label: "Battery low", fires: "The battery falls below your threshold while unplugged." },
];

/**
 * A tool the catalog offers but this page never mentions is a tool nobody will
 * ever ask for. Failing the build is the only check that cannot be ignored.
 */
const undocumented = TOOLS.filter((tool) => !TOOL_GUIDE[tool.name]).map(
  (tool) => tool.name,
);

if (undocumented.length > 0) {
  throw new Error(
    `lib/assistant/guide.ts is missing an entry for: ${undocumented.join(", ")}. ` +
      "Every tool in the catalog must be documented on the actions page.",
  );
}
