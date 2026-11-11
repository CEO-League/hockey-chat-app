import { attachSparePlayers, findViewingTeam } from "./utils/teamHelpers.js";
import { lazy, Suspense, useEffect, useState } from "react";
import StreamSessionProvider from "./components/chat/StreamSessionProvider";
import ChatUnreadBadge from "./components/chat/ChatUnreadBadge";
const StreamChatPage = lazy(() => import("./components/chat/ChatPage"));
import { supabase } from "./lib/supabaseClient";
import { loadAuthenticatedProfile } from "./lib/authHelpers.js";
import { downloadScheduleIcs } from "./utils/calendarExport.js";
import { IconCheck, IconX, IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import HockeyIcon from "./components/HockeyIcon.jsx";
import NextGameBanner from "./components/NextGameBanner.jsx";
import {
    FEED_TYPE_LABELS,
    resolveRsvp,
    countFieldSkaters,
    countNoResponse,
    rsvpLabel,
    formatSubStatus,
    isGoalieNeeded,
    buildNextGameContext,
    formatAttendanceDetail,
    getChatPrefill,
    loadAttendanceSummaries,
} from "./utils/gameHelpers.js";
import {
    applyRsvpAttendanceChange,
    canRsvpToGame,
    filterGamesForTeam,
    filterUpcomingGamesForTeam,
    formatDateKey,
    formatGameDate,
    formatGameTime,
    gameEndTime,
    isValidRsvpStatus,
} from "./utils/scheduleHelpers.js";
import Directory from './components/Directory';
import ProfileEditor from './components/ProfileEditor';
import Login from './components/Login';
import SubsTab from './components/SubsTab';
import ProfileView from './components/ProfileView';
import SetPassword from './components/SetPassword';
import AdminScheduleView from './components/admin/AdminScheduleView';
import AdminProfilesView from './components/admin/AdminProfilesView';
import AdminNoticeView from './components/admin/AdminNoticeView';
import AdminEmailView from './components/admin/AdminEmailView';
import { manageableTeams } from "./utils/rsvpManagement.js";
import RsvpManagement from "./components/RsvpManagement.jsx";
import SavedTab from './components/SavedTab';


const NAV_ITEMS = [
    { id: "dashboard", label: "Dashboard" },
    { id: "schedule", label: "Schedule" },
    { id: "teams", label: "Teams" },
    { id: "directory", label: "Directory"},
    { id: "subs", label: "Subs"},
    { id: "notices", label: "League Notices" },
    { id: "chat", label: "Chat" },
];

function AttendanceHero({ going, rosterTotal }) {
    return (
        <div className="attendance-hero">
            <span className="attendance-hero-number">{going} skaters</span>
            {rosterTotal != null && (
                <span className="attendance-hero-secondary">{rosterTotal} rostered skaters</span>
            )}
        </div>
    );
}

function AttendancePills({ attendance }) {
    const { going = 0, maybe = 0, out = 0, noResponse = 0 } = attendance ?? {};
    return (
        <div className="attendance-pills">
            <span className="count count--going">Going <strong>{going}</strong></span>
            {maybe > 0 && <span className="count count--maybe">Maybe <strong>{maybe}</strong></span>}
            {out > 0 && <span className="count count--out">Out <strong>{out}</strong></span>}
            {noResponse > 0 && (
                <span className="count count--pending">No response <strong>{noResponse}</strong></span>
            )}
        </div>
    );
}

function AttendanceSummary({ attendance, rosterTotal, showBar = false }) {
    const { going = 0 } = attendance ?? {};

    return (
        <div className="attendance-summary">
            <AttendanceHero going={going} rosterTotal={rosterTotal} />
            <AttendancePills attendance={attendance} />
        </div>
    );
}

function RsvpControls({ value, onChange, size = "default" }) {
    return (
        <div className={`rsvp-controls rsvp-controls--${size}`}>
            {["going", "maybe", "out"].map((id) => (
                <button
                    key={id}
                    type="button"
                    className={`rsvp-btn rsvp-btn--${id}${value === id ? " is-active" : ""}`}
                    onClick={() => onChange(id)}
                >
                    {rsvpLabel(id)}
                </button>
            ))}
        </div>
    );
}

function LeagueFeed({ items, limit, expandedId, onToggle, title = "League Feed" }) {
    const visible = limit ? items.slice(0, limit) : items;

    return (
        <section className="content-card feed-card">
            <header className="content-card-header">
                <h2>{title}</h2>
            </header>
            {visible.length === 0 ? (
                <p className="empty-state">No league activity yet.</p>
            ) : (
                <ul className="feed-list">
                    {visible.map((item) => {
                        const expanded = expandedId === item.id;

                        return (
                            <li 
                                key={item.id} 
                                className={`feed-item feed-item--${item.type}`}
                            >
                                <button
                                    type="button"
                                    className="feed-item-toggle"
                                    onClick={() => onToggle?.(expanded ? null : item.id)}
                                    aria-expanded={expanded}
                                >
                                    <span className="feed-badge">{FEED_TYPE_LABELS[item.type] ?? item.type}</span>
                                    <span className="feed-body">{item.message}</span>
                                    <time className="feed-date">{item.date}</time>
                                    {onToggle && (
                                        expanded
                                            ? <IconChevronDown size={14} className="feed-chevron" />
                                            : <IconChevronRight size={14} className="feed-chevron" />
                                    )}
                                </button>
                                {expanded && (
                                    <div className="feed-expanded">
                                        <strong>{item.title}</strong>
                                        <p>{item.message}</p>
                                        <span className="feed-expanded-date">Posted {item.date}</span>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}

function TonightsRoster({ game, myTeam, rsvpsByProfile = {}, onPromptPlayers }) {

    const players =
        myTeam?.team_members ??
        myTeam?.roster ??
        []

    if (!game) {
        return (
            <aside className="right-rail">
                <h3 className="rail-heading">Tonight&apos;s Roster</h3>
                <p className="rail-empty">No upcoming game.</p>
            </aside>
        )
    }

    if (!myTeam) {
        return (
            <aside className="right-rail">
                <h3 className="rail-heading">
                    Tonight&apos;s Roster
                </h3>
                <p className="rail-empty">
                    No team is associated with this profile.
                </p>
            </aside>
        )
    }

    if (players.length === 0) {
        return (
            <aside className="right-rail">
                <h3 className="rail-heading">Tonight&apos;s Roster</h3>
                <p className="rail-empty">No roster loaded yet.</p>
            </aside>
        )
    }

    return (
        <aside className="right-rail">
            <h3 className="rail-heading">Tonight&apos;s Roster</h3>

            <GameRosterList
                players={players}
                rsvpsByProfile={rsvpsByProfile}
                variant="desktop"
            />

            {onPromptPlayers && (
                <button
                    type="button"
                    className="action-btn action-btn--outline"
                    onClick={onPromptPlayers}
                >
                    Prompt No Response
                </button>
            )}
        </aside>
    )
}

function GameDetailModal({
    access,
    onRsvpSaved,
    game,
    onClose,
    onMessageTeam,
    onRequestSub,
}) {
    const home = game.home_team_name ?? "TBD";
    const away = game.away_team_name ?? "TBD";
    const date = formatGameDate(game.game_date);
    const startTime = formatGameTime(game.start_time);
    const endTime = formatGameTime(gameEndTime(game.start_time));
    const time = `${startTime} – ${endTime}`;
    const rink = `${game.location_name ?? "TBD"}${
        game.rink ? ` · ${game.rink}` : ""
    }`;

    const [attendanceState, setAttendanceState] = useState(null);
    const [savingRsvp, setSavingRsvp] = useState(false);
    const [rsvpError, setRsvpError] = useState("");
    const [rsvpNotice, setRsvpNotice] = useState("");
    const canEditTeam = (teamId) => manageableTeams([{ id: teamId }], access).length > 0;

    async function saveTeamRsvp(player, status) {
        const profileId = player.profile_id ?? player.profiles?.id;
        if (savingRsvp || !profileId || !canEditTeam(player.team_id) || (status !== "pending" && !isValidRsvpStatus(status))) return;
        setSavingRsvp(true);
        setRsvpError("");
        setRsvpNotice("");
        try {
            const { error } = await supabase.rpc("manage_game_rsvp", {
                p_game_id: String(game.id), p_profile_id: String(profileId),
                p_team_id: String(player.team_id), p_status: status,
            });
            if (error) throw error;
            setAttendanceState((previous) => {
                const responses = { ...previous.rsvpsByProfile, [profileId]: status };
                const next = { ...previous, rsvpsByProfile: responses };
                for (const side of ["home", "away"]) {
                    const going = previous[side].roster.filter((member) => responses[member.profile_id] === "going");
                    const goalieIds = new Set(going.filter((member) =>
                        ["g", "goalie", "goaltender"].includes((member.position ?? "").trim().toLowerCase())
                    ).map((member) => member.profile_id));
                    const skaterIds = new Set(going.filter((member) => !goalieIds.has(member.profile_id)).map((member) => member.profile_id));
                    next[side] = { ...previous[side], going: new Set(going.map((member) => member.profile_id)).size,
                        goalie: goalieIds.size > 0, subs: skaterIds.size >= 10 ? "" : "Subs needed" };
                }
                return next;
            });
            setRsvpNotice(`RSVP updated for ${player.profiles?.full_name ?? "player"}.`);
            onRsvpSaved?.();
        } catch (error) {
            setRsvpError(`Could not save RSVP: ${error.message}`);
        } finally { setSavingRsvp(false); }
    }

    useEffect(() => {
        let cancelled = false;

        async function loadGameAttendance() {
            try {
                const teamIds = [game.home_team_id, game.away_team_id].filter(Boolean);
                const [membersResult, rsvpsResult] = await Promise.all([
                    supabase
                        .from("team_members")
                        .select("profile_id, team_id, position, profiles(id, full_name)")
                        .in("team_id", teamIds),
                    supabase
                        .from("game_rsvps")
                        .select("profile_id, status")
                        .eq("game_id", game.id),
                ]);

                if (membersResult.error) throw membersResult.error;
                if (rsvpsResult.error) throw rsvpsResult.error;

                const goingProfileIds = new Set(
                    (rsvpsResult.data ?? [])
                        .filter((rsvp) => rsvp.status === "going")
                        .map((rsvp) => rsvp.profile_id)
                );
                const getTeamStatus = (teamId) => {
                    const goingMembers = (membersResult.data ?? []).filter(
                        (member) => member.team_id === teamId && goingProfileIds.has(member.profile_id)
                    );
                    const isGoalie = (member) => ["g", "goalie", "goaltender"].includes(
                        (member.position ?? "").trim().toLowerCase()
                    );
                    const goalieIds = new Set(goingMembers.filter(isGoalie).map((member) => member.profile_id));
                    const skaterIds = new Set(
                        goingMembers.filter((member) => !goalieIds.has(member.profile_id)).map((member) => member.profile_id)
                    );
                    return {
                        going: new Set(goingMembers.map((member) => member.profile_id)).size,
                        goalie: goalieIds.size > 0,
                        subs: skaterIds.size >= 10 ? "" : "Subs needed",
                        roster: (membersResult.data ?? [])
                            .filter((member) => member.team_id === teamId)
                            .sort((a, b) => (a.profiles?.full_name ?? "").localeCompare(b.profiles?.full_name ?? "")),
                    };
                };

                if (!cancelled) {
                    setAttendanceState({
                        rsvpsByProfile: Object.fromEntries(
                            (rsvpsResult.data ?? []).map((rsvp) => [rsvp.profile_id, rsvp.status])
                        ),
                        home: getTeamStatus(game.home_team_id),
                        away: getTeamStatus(game.away_team_id),
                    });
                }
            } catch (error) {
                console.error("Unable to load game attendance:", error);
                if (!cancelled) setAttendanceState({ error: true });
            }
        }

        loadGameAttendance();
        return () => { cancelled = true; };
    }, [game.id, game.home_team_id, game.away_team_id]);

    const statusLabel = (side, field) => {
        if (!attendanceState) return "Loading...";
        if (attendanceState.error) return "Unavailable";
        const value = attendanceState[side]?.[field];
        if (value == null) return "Loading...";
        if (field === "goalie") {
            const Icon = value ? IconCheck : IconX;
            const label = value ? "Goalie available" : "Goalie needed";
            return (
                <span className={value ? "text-going" : "text-out"} role="img" aria-label={label} title={label}>
                    <Icon size={22} stroke={3} aria-hidden="true" />
                </span>
            );
        }
        return field === "going" ? `${value} going` : value;
    };

    return (
        <div className="modal-backdrop">
            <div className="modal-card game-detail-modal">
                <header className="modal-header">
                    <h3>
                        {home} vs {away}
                    </h3>

                    <button
                        type="button"
                        className="modal-close"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </header>

                <div className="game-detail-list">
                    <div>
                        <span>Date</span>
                        <strong>{date}</strong>
                    </div>

                    <div>
                        <span>Time</span>
                        <strong>{time}</strong>
                    </div>

                    <div>
                        <span>Rink</span>
                        <strong>{rink}</strong>
                    </div>
                </div>

                <div className="game-team-comparison">
                    <div className="game-team-comparison-header">
                        <span></span>
                        <strong><span className="game-team-side">Home</span>{home}</strong>
                        <strong><span className="game-team-side">Away</span>{away}</strong>
                    </div>

                    <div className="game-team-comparison-row">
                        <span>Attendance</span>
                        <strong>{statusLabel("home", "going")}</strong>
                        <strong>{statusLabel("away", "going")}</strong>
                    </div>

                    <div className="game-team-comparison-row">
                        <span>Goalie</span>
                        <strong>{statusLabel("home", "goalie")}</strong>
                        <strong>{statusLabel("away", "goalie")}</strong>
                    </div>

                    <div className="game-team-comparison-row game-team-comparison-row--subs">
                        <span>Subs</span>
                        <strong>{statusLabel("home", "subs")}</strong>
                        <strong>{statusLabel("away", "subs")}</strong>
                    </div>
                </div>

                <section className="game-detail-rosters" aria-label="Team rosters">
                    <h4>Team rosters</h4>
                    {rsvpError && <p className="admin-save-error" role="alert">{rsvpError}</p>}
                    {rsvpNotice && <p role="status">{rsvpNotice}</p>}
                    {!attendanceState ? (
                        <p role="status">Loading rosters...</p>
                    ) : attendanceState.error ? (
                        <p role="status">Unable to load rosters.</p>
                    ) : (
                        [["home", home, "Home"], ["away", away, "Away"]].map(([side, name, label]) => (
                            <section className="game-detail-team-roster" key={side} aria-label={`${label}: ${name} roster`}>
                                <h5>{label}: {name}</h5>
                                {canEditTeam(game[`${side}_team_id`]) && <p>Change a player's RSVP below.</p>}
                                {attendanceState[side].roster.length > 0 ? (
                                    <>
                                        <div className="game-detail-roster-desktop">
                                            <GameRosterList
                                                players={attendanceState[side].roster}
                                                rsvpsByProfile={attendanceState.rsvpsByProfile}
                                                onRsvpChange={canEditTeam(game[`${side}_team_id`]) ? saveTeamRsvp : undefined}
                                                saving={savingRsvp}
                                            />
                                        </div>
                                        <div className="game-detail-roster-mobile">
                                            <GameRosterList
                                                players={attendanceState[side].roster}
                                                rsvpsByProfile={attendanceState.rsvpsByProfile}
                                                onRsvpChange={canEditTeam(game[`${side}_team_id`]) ? saveTeamRsvp : undefined}
                                                saving={savingRsvp}
                                                variant="mobile"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <p>No players rostered.</p>
                                )}
                            </section>
                        ))
                    )}
                </section>

                <footer className="modal-actions">
                    <button
                        type="button"
                        className="action-btn action-btn--primary"
                        onClick={onMessageTeam}
                    >
                        Message Team
                    </button>

                    <button
                        type="button"
                        className="action-btn action-btn--secondary"
                        onClick={onRequestSub}
                    >
                        Request Sub
                    </button>
                </footer>
            </div>
        </div>
    );
}

function App() {
    const [session, setSession] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [currentProfile, setCurrentProfile] = useState(null);
    const [accessDenied, setAccessDenied] = useState(false);
    const [activeView, setActiveView] = useState("dashboard");
    const [scheduleTargetGame, setScheduleTargetGame] = useState(null);
    const [teamRevision, setTeamRevision] = useState(0);
    const [selectedTeam, setSelectedTeam] = useState(null);
    const [editingPlayer, setEditingPlayer] = useState(false);
    const [selectedPlayer, setSelectedPlayer] = useState(null);

    const [userRsvp, setUserRsvp] = useState("pending");
    const [subRequested, setSubRequested] = useState(false);
    const [teamAttendance, setTeamAttendance] = useState({
        going: 0,
        maybe: 0,
        out: 0,
        noResponse: 0,
    });
    const [rsvpsByProfile, setRsvpsByProfile] = useState({})
    const [mobileRsvpsByGame, setMobileRsvpsByGame] = useState({});
    const [mobileAttendanceByGame, setMobileAttendanceByGame] = useState({});
    const [mobileRsvpsByProfileByGame, setMobileRsvpsByProfileByGame] = useState({})



    const [chatDraft, setChatDraft] = useState("");
    const [expandedFeedId, setExpandedFeedId] = useState(null);
    const [expandedNoticeId, setExpandedNoticeId] = useState(null);

    const [upcomingGames, setUpcomingGames] = useState([]);
    const [today, setToday] = useState(() => formatDateKey(new Date()));

    useEffect(() => {
        const refreshDate = () => setToday(formatDateKey(new Date()));
        const timer = window.setInterval(refreshDate, 30000);
        window.addEventListener('focus', refreshDate);
        document.addEventListener('visibilitychange', refreshDate);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', refreshDate);
            document.removeEventListener('visibilitychange', refreshDate);
        };
    }, []);
    const [nextGameIndex, setNextGameIndex] = useState(0);

    const [leagueAlerts, setLeagueAlerts] = useState([]);
    const [leagueAlertsLoading, setLeagueAlertsLoading] = useState(false);
    const [leagueAlertsError, setLeagueAlertsError] = useState("");

    const [leagueNotice, setLeagueNotice] = useState(null);
    const [leagueTicker, setLeagueTicker] = useState(null);

    const [announcementFormOpen, setAnnouncementFormOpen] =
    useState(false)

    const [announcementDraft, setAnnouncementDraft] = useState({
        title: "",
        summary: "",
        message: "",
    })

    const [announcementSubmitting, setAnnouncementSubmitting] =
        useState(false)

    const [announcementSubmitError, setAnnouncementSubmitError] =
        useState("")

    const [feedItems, setFeedItems] = useState([]);
    const [feedLoading, setFeedLoading] = useState(false)
    const [feedError, setFeedError] = useState("")

    const [teams, setTeams] = useState([]);

    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

    const searchParams = new URLSearchParams(window.location.search)

    const isSetPasswordPage = window.location.pathname === "/set-password" || searchParams.get("page") === "set-password"

    const [managementAccess, setManagementAccess] = useState(null);
    const [managementError, setManagementError] = useState("");
    const [rsvpRevision, setRsvpRevision] = useState(0);
    useEffect(() => {
        let cancelled = false;
        async function loadAccess() {
            if (!session?.user?.id) return;
            try {
                const { data, error } = await supabase.rpc("rsvp_management_access");
                if (error) throw error;
                if (cancelled) return;
                setManagementAccess({ ...data, userId: session.user.id });
                setManagementError("");
            } catch {
                if (cancelled) return;
                setManagementAccess(null);
                setManagementError("Team management permissions could not be loaded. Please reload or contact an administrator.");
            }
        }
        loadAccess();
        return () => { cancelled = true; };
    }, [session?.user?.id, teamRevision]);
    const access = managementAccess?.userId === session?.user?.id ? managementAccess : null;
    const isAdmin = access?.is_admin === true;
    const canManageRsvps = isAdmin;

    const rawMyTeam = findViewingTeam(teams, currentProfile);

    const isMainTeamView = (rawMyTeam?.team_members ?? []).some(
        (member) => member.profiles?.id === currentProfile?.id
    );
    const currentTeamId = isMainTeamView ? rawMyTeam.id : null;

    const myTeam = rawMyTeam
        ? {
              ...rawMyTeam,
              canRsvp: isMainTeamView,
              roster: rawMyTeam.team_members ?? [],
          }
        : null;

    useEffect(() => {
        let isMounted = true
        let authCheckNumber = 0
        let authenticatedUserId

        async function processSession(nextSession) {
            if (!isMounted) return

            const nextUserId = nextSession?.user?.id ?? null
            // Supabase also emits sign-in events when browser focus returns.
            // Refresh the token without tearing down the current user's tabs.
            if (authenticatedUserId === nextUserId) {
                setSession(nextSession)
                return
            }
            authenticatedUserId = nextUserId
            const currentCheck = ++authCheckNumber
            setActiveView("dashboard")
            setSelectedTeam(null)
            setSelectedPlayer(null)
            setEditingPlayer(false)
            setChatDraft("")
            setAnnouncementFormOpen(false)
            setAnnouncementDraft({ title: "", summary: "", message: "" })

            setSession(nextSession)
            setCurrentProfile(null)
            setAccessDenied(false)
            setAuthLoading(true)

            if (!nextSession?.user) {
                setAuthLoading(false)
                return
            }

            let {
                profile,
                error,
            } = await loadAuthenticatedProfile(nextSession.user.id)

            // Ignore this result if another authentication check started
            // while the database request was running.
            if (!isMounted || currentCheck !== authCheckNumber) {
                return
            }

            if (error) {
                console.error(
                    "Unable to check profile access",
                    error
                )

                setCurrentProfile(null)
                setAccessDenied(true)
                setAuthLoading(false)
                return
            }

            // A profile may exist for this email but not yet be linked
            // to the newly authenticated Supabase user.
            if (!profile) {
                const {
                    data: linkResult,
                    error: linkError,
                } = await supabase.rpc(
                    "link_authenticated_profile"
                )

                // Ignore this result if another authentication check started
                // while the profile-linking request was running.
                if (!isMounted || currentCheck !== authCheckNumber) {
                    return
                }

                if (linkError) {
                    console.error(
                        "Unable to connect authenticated user to profile",
                        linkError
                    )

                    setCurrentProfile(null)
                    setAccessDenied(true)
                    setAuthLoading(false)
                    return
                }

                const linkSucceeded =
                    linkResult?.status === "linked" ||
                    linkResult?.status === "already_linked"

                if (!linkSucceeded) {
                    console.warn(
                        "Access denied: profile could not be connected",
                        linkResult?.status
                    )

                    setCurrentProfile(null)
                    setAccessDenied(true)
                    setAuthLoading(false)
                    return
                }

                const linkedProfileResult =
                    await loadAuthenticatedProfile(
                        nextSession.user.id
                    )

                // Ignore this result if another authentication check started
                // while the linked profile was being loaded.
                if (!isMounted || currentCheck !== authCheckNumber) {
                    return
                }

                profile = linkedProfileResult.profile
                error = linkedProfileResult.error

                if (error || !profile) {
                    console.error(
                        "Profile was connected, but could not be loaded",
                        error
                    )

                    setCurrentProfile(null)
                    setAccessDenied(true)
                    setAuthLoading(false)
                    return
                }
            }

            setCurrentProfile(profile)
            setAccessDenied(false)
            setActiveView("dashboard")
            setAuthLoading(false)
        }
        
        async function initializeAuth() {
            const { data: {session: initialSession}, error } = await supabase.auth.getSession()

            if (error) {
                console.error(
                    "Unable to restore authentication session:",
                    error
                )

                if (isMounted) {
                    setSession(null)
                    setCurrentProfile(null)
                    setAuthLoading(false)
                }

                return
            }

            await processSession(initialSession)
        }

        initializeAuth()

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(
            (_event, nextSession) => {
                processSession(nextSession)
            }
        )

        return () => {
            isMounted = false
            authCheckNumber += 1
            subscription.unsubscribe()
        }
    }, [])

    async function loadLeagueAlerts(leagueName) {
        if (!leagueName) {
            setLeagueAlerts([]);
            return;
        }

        setLeagueAlertsLoading(true);
        setLeagueAlertsError("");

        const { data, error } = await supabase
            .from("announcements")
            .select(`
                id,
                title,
                summary,
                message,
                related_game_id,
                created_at
            `)
            .eq("league_name", leagueName)
            .is("team_id", null)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Unable to load league announcements:", error);
            setLeagueAlerts([]);
            setLeagueAlertsError("Unable to load league announcements.");
            setLeagueAlertsLoading(false);
            return;
        }

        const formattedAlerts = (data ?? []).map((announcement) => ({
            id: announcement.id,
            title: announcement.title,
            summary: announcement.summary,
            message: announcement.message,
            relatedGameId: announcement.related_game_id,
            date: new Intl.DateTimeFormat("en-US", {
                month: "short",
                day: "numeric",
            }).format(new Date(announcement.created_at)),
        }));

        setLeagueAlerts(formattedAlerts);
        setLeagueAlertsLoading(false);
    }

    async function loadLeagueNotice(leagueName) {
        if (!leagueName) {
            setLeagueNotice(null);
            setLeagueTicker(null);
            return;
        }
        const { data } = await supabase
            .from("league_notices")
            .select("id, title, message, created_at, notice_type")
            .eq("league_name", leagueName)
            .eq("is_active", true)
            .order("created_at", { ascending: false });
        const rows = data ?? [];
        setLeagueNotice(rows.find((n) => n.notice_type === "banner") ?? null);
        setLeagueTicker(rows.find((n) => n.notice_type === "ticker") ?? null);
    }

    async function handleCreateAnnouncement(event) {
        event.preventDefault()

        const title = announcementDraft.title.trim()
        const summary = announcementDraft.summary.trim()
        const message = announcementDraft.message.trim()

        if (!isAdmin) {
            setAnnouncementSubmitError(
                "You do not have permission to create announcements."
            )
            return
        }

        if (!title || !message) {
            setAnnouncementSubmitError(
                "Enter a title and announcement message."
            )
            return
        }

        if (!currentLeagueName || !currentProfile?.id) {
            setAnnouncementSubmitError(
                "The league or signed-in profile could not be identified."
            )
            return
        }

        setAnnouncementSubmitting(true)
        setAnnouncementSubmitError("")

        const { data: createdAnnouncement, error: announcementError, } = await supabase
            .from("announcements")
            .insert({
                league_name: currentLeagueName,
                team_id: null,
                title,
                summary: summary || null,
                message,
                created_by: currentProfile.id,
            })
            .select("id")
            .single()
        
        if (announcementError) {
            console.error(
                "Unable to create league announcements:",
                announcementError
            )

            setAnnouncementSubmitError(
                "Unable to create the announcement."
            )
            setAnnouncementSubmitting(false)
            return
        }

        await createLeagueFeedEvent({
            eventType: "announcement",
            title: "New league announcement",
            message: `${currentProfile.full_name ?? "An admin"} posted “${title}.”`,
            relatedEntityType: "announcement",
            relatedEntityId: createdAnnouncement.id,
        });

        setAnnouncementDraft({
            title: "",
            summary: "",
            message: "",
        });

        setAnnouncementFormOpen(false);
        setAnnouncementSubmitting(false);

        await loadLeagueAlerts(currentLeagueName);
    
    }

    useEffect(() => {
        if (!currentProfile) {
            setTeams([])
            return
        }

        async function loadTeams() {
            const { data, error } = await supabase
                .from("teams")
                .select(`
                    id,
                    name,
                    league_name,
                    sponsor_image_url,
                    team_members (
                        id,
                        jersey_number,
                        position,
                        profiles!inner (
                            id,
                            full_name,
                            email,
                            phone,
                            notes,
                            auth_user_id,
                            active_team_id
                        )
                    )
                `)
                .eq("team_members.profiles.is_system_account", false)
                .order("name")

            if (error) {
                console.error("Error loading teams:", error)
                return
            }

            const { data: preferences, error: spareError } = await supabase
                .from("sub_team_preferences")
                .select("team_id, profiles!inner(id, full_name, email, phone, notes, auth_user_id, active_team_id)")
                .eq("profiles.is_system_account", false)
            if (spareError) {
                console.error("Error loading spare teams:", spareError)
                return
            }
            setTeams(attachSparePlayers(data ?? [], preferences ?? []))
        }

        loadTeams()
    }, [currentProfile, teamRevision])

    const currentLeagueName = teams[0]?.league_name ?? null;

    useEffect(() => {
        if (!currentLeagueName) {
            setLeagueAlerts([]);
            setFeedItems([]);
            return;
        }
        
        loadLeagueAlerts(currentLeagueName);
        loadLeagueFeed(currentLeagueName);
        loadLeagueNotice(currentLeagueName);
    }, [currentLeagueName]);

    const upcomingGame = upcomingGames[nextGameIndex];

    useEffect(() => {
        if (!currentProfile?.id || !myTeam?.id) {
            setUpcomingGames([]);
            setNextGameIndex(0);
            return;
        }

        let cancelled = false;
        setUpcomingGames([]);
        setNextGameIndex(0);
        async function loadUpcomingGames() {
            const { data, error } = await supabase
                .from('games')
                .select('*')
                .gte('game_date', today)
                .or(`home_team_id.eq.${myTeam.id},away_team_id.eq.${myTeam.id}`)
                .order('starts_at', { ascending: true });

            if (error) {
                console.error(error);
                return;
            }

            if (cancelled) return;
            // Fail closed even if a future query change accidentally returns
            // a game outside this player's team.
            setUpcomingGames(
                filterUpcomingGamesForTeam(data ?? [], myTeam.id, today)
            );
            setNextGameIndex(0);
        }

        loadUpcomingGames();
        return () => { cancelled = true; };
    }, [currentProfile?.id, myTeam?.id, today]);


    const currentUserId = currentProfile?.id ?? null;


    // What did THIS USER answer?
    useEffect(() => {
        if (!upcomingGame?.id || !currentProfile?.id) {
            setUserRsvp("pending");
            return;
        }
        
        let cancelled = false;
        setUserRsvp("pending");
        async function loadCurrentRsvp() {
            const { data, error } = await supabase
                .from("game_rsvps")
                .select("status")
                .eq("game_id", upcomingGame.id)
                .eq("profile_id", currentProfile.id)
                .maybeSingle();

                if (error) {
                    console.error("Unable to load RSVP:", error);
                    return;
                }

                if (!cancelled) setUserRsvp(data?.status ?? "pending");
            }

            loadCurrentRsvp();
            return () => { cancelled = true; };
    }, [upcomingGame?.id, currentProfile?.id, rsvpRevision]);


    // WHat did EVERYONE answer?
    useEffect(() => {
        if(!upcomingGame?.id || !myTeam) {
            setTeamAttendance({
                going: 0,
                maybe: 0,
                out: 0,
                noResponse: 0,
            });

            setRsvpsByProfile({});
            return;
        }

        let cancelled = false;
        setRsvpsByProfile({});
        async function loadTeamAttendance() {
            const { data, error: attendanceError } = await supabase
                .from("game_rsvps")
                .select("profile_id, status")
                .eq("game_id", upcomingGame.id);
            
            if (attendanceError) {
                console.error("Unable to load team attendance:", attendanceError)
                return;
            }

            const teamProfileIds = new Set(
                (myTeam.team_members ?? []).map(
                    (member) =>
                        member.profile_id ??
                        member.profiles?.id
                )
            )

            const attendance = {
                going: 0,
                maybe: 0,
                out: 0,
                noResponse: 0,
            };

            const nextRsvpsByProfile = {};

            for (const rsvp of data ?? []) {
                // Ignore RSVPS from the opposing team.
                if (!teamProfileIds.has(rsvp.profile_id)) {
                    continue
                }
                // This rebuilds the Tonight's Roster after a refresh
                nextRsvpsByProfile[rsvp.profile_id] = rsvp.status ?? "pending"

                if (rsvp.status === "going") {
                    attendance.going += 1;
                } else if (rsvp.status === "maybe") {
                    attendance.maybe += 1;
                } else if (rsvp.status === "out") {
                    attendance.out += 1;
                }
            }

            const responded = attendance.going + attendance.maybe + attendance.out

            attendance.noResponse = Math.max(
                0,
                teamProfileIds.size - responded
            )

            if (cancelled) return;
            setTeamAttendance(attendance);

            // Persisted DB values are now copied back into React state.
            setRsvpsByProfile(nextRsvpsByProfile)
        
        }

        loadTeamAttendance();
        return () => { cancelled = true; };
    }, [upcomingGame?.id, myTeam?.id, myTeam?.team_members, rsvpRevision]);

    const rosterAttendance = Object.values(
        rsvpsByProfile
    ).reduce(
        (counts, status) => {
            if (status === "going") {
                counts.going += 1
            } else if (status === "maybe") {
                counts.maybe += 1
            } else if (status === "out") {
                counts.out += 1
            }

            return counts
        },
        {
            going: 0,
            maybe: 0,
            out: 0,
            noResponse: 0,
        }
    )

    const gameContext = buildNextGameContext({
        game: upcomingGame,
        myTeam,
        teams,
        attendance: teamAttendance,
        rsvpsByProfile,
        subRequested,
        userRsvp,
        currentUserId,
    });


    async function handleRsvp(status) {
        if (
            !upcomingGame?.id ||
            !currentProfile?.id ||
            !isValidRsvpStatus(status) ||
            status === userRsvp
        ) {
            return;
        }

        if (!myTeam?.canRsvp || !canRsvpToGame(upcomingGame, myTeam?.id)) {
            console.warn(
                "Blocked RSVP for game outside player's team",
                upcomingGame.id
            );
            return;
        }

        const previousStatus = userRsvp;

        const { data: savedRsvp, error: rsvpError } = await supabase
            .from("game_rsvps")
            .upsert(
                {
                    game_id: upcomingGame.id,
                    profile_id: currentProfile.id,
                    status,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "game_id,profile_id",
                }
            )
            .select("game_id, profile_id, status, updated_at")
            .single()

        if (rsvpError) {
            console.error("Unable to save RSVP:", rsvpError);
            return;
        }

        setUserRsvp(status);

        setRsvpsByProfile((current) => ({
            ...current,
            [currentProfile.id]: status,
        }));

        setTeamAttendance((current) =>
            applyRsvpAttendanceChange(
                current,
                previousStatus,
                status
            )
        );

        // Keep the schedule state in sync when an RSVP changes on Dashboard.
        setMobileRsvpsByGame((current) => ({
            ...current,
            [upcomingGame.id]: status,
        }));

        setMobileAttendanceByGame((current) => ({
            ...current,
            [upcomingGame.id]: applyRsvpAttendanceChange(
                current[upcomingGame.id] ?? teamAttendance,
                previousStatus,
                status
            ),
        }));

        await createLeagueFeedEvent({
            eventType: "attendance_update",
            title: "Attendance updated",
            message: `${
                currentProfile.full_name ?? "A player"
            } marked ${rsvpLabel(status)} for ${
                gameContext?.matchup ?? "the next game"
            }.`,
            teamId: myTeam.id,
            relatedEntityType: "game",
            relatedEntityId: upcomingGame.id,
        });
    }
    
    useEffect(() => {
        if (!currentProfile?.id || upcomingGames.length === 0) {
            setMobileRsvpsByGame({});
            setMobileAttendanceByGame({});
            return;
        }

        let cancelled = false;
        async function loadMobileGameData() {
            const gameIds = upcomingGames.map((game) => game.id);

            const { data, error } = await supabase
                .from("game_rsvps")
                .select("game_id, profile_id, status")
                .in("game_id", gameIds);
            
            if (error) {
                console.error("Unable to load mobile game RSVPS:", error)
                return;
            }

            const nextRsvpsByGame = {};
            const nextAttendanceByGame = {};
            const nextRsvpsByProfileByGame = {}
            
            // Create an empty bucket for every game first
            for (const game of upcomingGames) {
                nextRsvpsByGame[game.id] = "pending";

                nextAttendanceByGame[game.id] = {
                    going: 0,
                    maybe: 0,
                    out: 0,
                    noResponse: 0,
                };

                nextRsvpsByProfileByGame[game.id] = {}
            }

            const teamProfileIds = new Set(
                (myTeam?.team_members ?? []).map(
                    (member) =>
                        member.profile_id ??
                        member.profiles?.id
                )
            )

            // Now fill those buckets from Supabase
            for (const rsvp of data ?? []) {
                if (!teamProfileIds.has(rsvp.profile_id)) {
                    continue
                }

                const attendance = nextAttendanceByGame[rsvp.game_id];

                if (!attendance) {
                    continue;
                }

                nextRsvpsByProfileByGame[rsvp.game_id][rsvp.profile_id] = rsvp.status ?? "pending"

                if (rsvp.status === "going") {
                    attendance.going += 1;
                } else if (rsvp.status === "maybe") {
                    attendance.maybe += 1;
                } else if (rsvp.status === "out") {
                    attendance.out += 1;
                }

                if (rsvp.profile_id === currentProfile.id) {
                    nextRsvpsByGame[rsvp.game_id] =
                        rsvp.status ?? "pending";
                }
            }

            // Calculate unanwsered players for each game.
            for (const game of upcomingGames) {
                const attendance = nextAttendanceByGame[game.id]

                if (!attendance) {
                    continue
                }

                const responded = attendance.going + attendance.maybe + attendance.out

                attendance.noResponse = Math.max(
                    0,
                    teamProfileIds.size - responded
                )
            }

            if (cancelled) return;
            setMobileRsvpsByGame(nextRsvpsByGame);
            setMobileAttendanceByGame(nextAttendanceByGame);
            setMobileRsvpsByProfileByGame(nextRsvpsByProfileByGame)
        }

        loadMobileGameData();
        return () => { cancelled = true; };
    }, [upcomingGames, currentProfile?.id, myTeam?.id, rsvpRevision]);

    const mobileGameContexts = upcomingGames
        .map((game) => {
            const attendance = 
                mobileAttendanceByGame[game.id] ?? {
                    going: 0,
                    maybe: 0,
                    out: 0,
                    noResponse: 0,
                };

            const userRsvpForGame = mobileRsvpsByGame[game.id] ?? "pending"

            const context = buildNextGameContext({
                game,
                myTeam,
                teams,
                attendance,
                subRequested,
                userRsvp: userRsvpForGame,
                rsvpsByProfile: mobileRsvpsByProfileByGame[game.id] ?? {},
                currentUserId
            });

            return {
                game,
                context,
                userRsvp: userRsvpForGame,
                attendance,
            };
        })
        .filter((item) => item.context);
    
    async function onMobileRsvp(game, status) {
        if (
            !currentProfile?.id ||
            !game?.id ||
            !isValidRsvpStatus(status)
        ) {
            return;
        }

        if (!myTeam?.canRsvp || !canRsvpToGame(game, myTeam?.id)) {
            console.warn(
                "Blocked RSVP for game outside player's team",
                game.id
            );
            return;
        }

        if (game.id === upcomingGame?.id) {
            setRsvpsByProfile((current) => ({
                ...current,
                [currentProfile.id]: status,
            }));
        }

        const previousStatus = mobileRsvpsByGame[game.id] ?? "pending";

        if (status === previousStatus) {
            return;
        }

        const { error } = await supabase
            .from("game_rsvps")
            .upsert(
                {
                    game_id: game.id,
                    profile_id: currentProfile.id,
                    status,
                    updated_at: new Date().toISOString(),
                },
                {
                    onConflict: "game_id,profile_id",
                }
            );

        if (error) {
            console.error(
                "Unable to save mobile RSVP:",
                error
            );
            return;
        }

        setMobileRsvpsByGame((current) => ({
            ...current,
            [game.id]: status,
        }));

        setMobileAttendanceByGame((current) => ({
            ...current,
            [game.id]: applyRsvpAttendanceChange(
                current[game.id] ?? {
                    going: 0,
                    maybe: 0,
                    out: 0,
                    noResponse: 0,
                },
                previousStatus,
                status
            ),
        }));

        // Keep the desktop Next Game RSVP and counts in sync with
        // changes made from Schedule/mobile.
        if (game.id === upcomingGame?.id) {
            setUserRsvp(status);
            setTeamAttendance((current) =>
                applyRsvpAttendanceChange(
                    current,
                    previousStatus,
                    status
                )
            );
        }

        await createLeagueFeedEvent({
            eventType: "attendance_update",
            title: "Attendance updated",
            message: `${
                currentProfile.full_name ?? "A player"
            } marked ${rsvpLabel(status)} for ${
                game.home_team_name ?? "TBD"
            } vs ${game.away_team_name ?? "TBD"}.`,
            teamId: myTeam.id,
            relatedEntityType: "game",
            relatedEntityId: game.id,
        });
    }
    
    const navigateTo = (view) => {
        setScheduleTargetGame(null);
        setActiveView(view)
        setIsMobileNavOpen(false)
    }

    const openTeam = (team) => {
        setSelectedTeam(team)
        setSelectedPlayer(null)
        setEditingPlayer(false)
        setActiveView("teams")
    }

    const openPlayer = (player) => {
        setSelectedPlayer(player)
        setEditingPlayer(false)
    }

    const openChat = (prefill = "") => {
        setActiveView("chat");
        if (prefill) setChatDraft(prefill);
    };

    const promptNoResponse = () => openChat(getChatPrefill("prompt", gameContext));

    async function signOut() {
        const { error } = await supabase.auth.signOut()

        if (error) {
            console.error("Sign out error:", error.message)
        }
    }

    // League feed functions

    async function loadLeagueFeed(leagueName) {
        if (!leagueName) {
            setFeedItems([])
            return
        }

        setFeedLoading(true)
        setFeedError("")

        const { data, error } = await supabase
            .from("league_feed_events")
            .select(`
                id,
                event_type,
                title,
                message,
                related_entity_type,
                related_entity_id,
                created_at
            `)
            .eq("league_name", leagueName)
            .order("created_at", { ascending: false })
            .limit(50)
        
            if (error) {
                console.error("Unable to load league feed", error)
                setFeedItems([])
                setFeedError("Unable to load league activity.")
                setFeedLoading(false)
                return
            }

            const formattedFeedItems = (data ?? [])
                .filter((event) => event.event_type !== "attendance_update") 
                .map((event) =>  ({
                    id: event.id,
                    type: event.event_type,
                    title: event.title,
                    message: event.message,
                    date: new Intl.DateTimeFormat("en-US", {
                        month: "short",
                        day: "numeric",
                    }).format(new Date(event.created_at)),
                    relatedEntityType: event.related_entity_type,
                    relatedEntityId: event.related_entity_id,
                }));
            
            setFeedItems(formattedFeedItems)
            setFeedLoading(false)

            const attendanceSummaries = await loadAttendanceSummaries(supabase, leagueName)

            setFeedItems([
                ...attendanceSummaries,
                ...formattedFeedItems,
            ])
        }
    
    async function createLeagueFeedEvent({
        eventType,
        title,
        message,
        teamId = null,
        relatedEntityType = null,
        relatedEntityId = null
    }) {
        if(!currentLeagueName || !currentProfile?.id) {
            return {
                error: new Error(
                    "League or signed-in profile is unavailable."
                ),
            };
        }
        
        const { error: feedEventError } = await supabase
            .from("league_feed_events")
            .insert({
                league_name: currentLeagueName,
                team_id: teamId,
                actor_profile_id: currentProfile.id,
                event_type: eventType,
                title,
                message,
                related_entity_type: relatedEntityType,
                related_entity_id: relatedEntityId,
            });
        
        if (feedEventError) {
            console.error(
                "Unable to create league feed event:", 
                feedEventError
            );

            return {
                error: feedEventError,
            };
        }

        await loadLeagueFeed(currentLeagueName);

        return { 
            error: null, 
        };
    }

    const renderView = (view) => {
        if (view === "teams" && selectedPlayer && selectedTeam) {
            const profile = selectedPlayer.profiles

            if (!profile?.id) {
                return (
                    <div className="page-view player-detail-view">
                        <button
                            type="button"
                            className="back-button"
                            onClick={() => {
                                setSelectedPlayer(null)
                                setEditingPlayer(false)
                            }}
                        >
                            ← Back to roster
                        </button>

                        <section className="content-card">
                            <p className="empty-state">
                                This roster member does not have a profile yet.
                            </p>
                        </section>
                    </div>
                )
            }

            const isOwnProfile = currentProfile?.id === profile.id



            const canEditProfile = isOwnProfile || isAdmin

            const currentLeagueName = teams[0]?.league_name ?? "";

            if (editingPlayer && canEditProfile) {
                return (
                    <ProfileEditor
                        profile={profile}
                        onBack={() => setEditingPlayer(false)}
                        onSaved={(updatedProfile) => {
                            if (updatedProfile.id === currentProfile.id) setCurrentProfile(updatedProfile)
                            setTeamRevision((revision) => revision + 1)
                            setEditingPlayer(false)
                            setSelectedPlayer(null)
                            setSelectedTeam(null)
                        }}
                    />
                )
            }

            return (
                <ProfileView
                    profile={profile}
                    currentProfile={currentProfile}
                    onBack={() => {
                        setSelectedPlayer(null)
                        setEditingPlayer(false)
                    }}
                    onEdit={
                        canEditProfile
                            ? () => setEditingPlayer(true)
                            : undefined
                    }
                />
            )
        }

        if (selectedTeam && view === "teams") {
            return (
                <TeamDetail
                    team={selectedTeam}
                    teams={teams}
                    currentUserId={currentUserId}
                    userRsvp={userRsvp}
                    onBack={() => {
                        setSelectedTeam(null)
                        setSelectedPlayer(null)
                        setEditingPlayer(false)
                    }}
                    onSelectPlayer={openPlayer}
                    onSponsorImageUpdated={(teamId, newUrl) => {
                        setTeams((currentTeams) =>
                            currentTeams.map((currentTeam) =>
                                currentTeam.id === teamId
                                    ? {
                                        ...currentTeam,
                                        sponsor_image_url: newUrl
                                      }
                                    : currentTeam
                            )
                        )

                        setSelectedTeam((currentTeam) =>
                            currentTeam?.id === teamId
                                ?   {
                                    ...currentTeam,
                                    sponsor_image_url: newUrl
                                    }
                                : currentTeam
                        )

                    }}
                />
            )
        }

        switch (view) {
            case "dashboard":
                return (
                    <DashboardView
                        currentUserId={currentUserId}
                        gameContext={gameContext}
                        myTeam={myTeam}
                        userRsvp={userRsvp}
                        onRsvp={handleRsvp}
                        subRequested={subRequested}
                        onRequestSub={() => {
                            setSubRequested(true)
                            openChat(getChatPrefill("sub", gameContext))
                        }}
                        onMessageTeam={() =>
                            openChat(getChatPrefill("game", gameContext))
                        }
                        onPromptNoResponse={promptNoResponse}
                        onOpenTeam={openTeam}
                        onViewSchedule={(game) => {
                            navigateTo("schedule");
                            setScheduleTargetGame({ ...(game ?? upcomingGame) });
                        }}
                        feedItems={feedItems}
                        expandedFeedId={expandedFeedId}
                        onToggleFeed={setExpandedFeedId}
                        teams={teams}
                        games={upcomingGames}
                        mobileGameContexts={mobileGameContexts}
                        mobileRsvpsByProfileByGame={mobileRsvpsByProfileByGame}
                        onMobileRsvp={onMobileRsvp}
                        leagueNotice={leagueNotice}
                    />
                )

            case "schedule":
                return (
                    <ScheduleView
                        access={access}
                        onRsvpSaved={() => setRsvpRevision((value) => value + 1)}
                        requestedDetailGame={scheduleTargetGame}
                        currentTeamId={currentTeamId}
                        myTeam={myTeam}
                        onMessageTeam={() =>
                            openChat(getChatPrefill("game", gameContext))
                        }
                        onRequestSub={() => {
                            setSubRequested(true)
                            openChat(getChatPrefill("sub", gameContext))
                        }}
                        onMobileRsvp={onMobileRsvp}
                        mobileRsvpsByGame={mobileRsvpsByGame}
                        mobileAttendanceByGame={mobileAttendanceByGame}
                    />                  
                )

            case "teams":
                return (
                    <TeamsView
                        teams={teams}
                        onSelectTeam={openTeam}
                    />
                )

            case "directory":
                return <Directory />

            case "subs":
                return <SubsTab />

            case "notices":
                return (
                    <NoticesView
                        alerts={leagueAlerts}
                        alertsLoading={leagueAlertsLoading}
                        alertsError={leagueAlertsError}
                        feedItems={feedItems}
                        expandedNoticeId={expandedNoticeId}
                        onToggleNotice={setExpandedNoticeId}
                        expandedFeedId={expandedFeedId}
                        onToggleFeed={setExpandedFeedId}
                        onViewGame={() => navigateTo("schedule")}
                        
                        canCreateAnnouncement={isAdmin}
                        announcementFormOpen={announcementFormOpen}
                        announcementDraft={announcementDraft}
                        announcementSubmitting={announcementSubmitting}
                        announcementSubmitError={announcementSubmitError}

                        onOpenAnnouncementForm={() => {
                            setAnnouncementSubmitError("")
                            setAnnouncementFormOpen(true)
                        }}

                        onCloseAnnouncementForm={() => {
                            setAnnouncementSubmitError("")
                            setAnnouncementFormOpen(false)
                        }}

                        onAnnouncementDraftChange={setAnnouncementDraft}
                        onCreateAnnouncement={handleCreateAnnouncement}
                    />
                );

            case "chat":
                return (
                    <Suspense fallback={<p role="status">Loading chat?</p>}>
                        <StreamChatPage active={activeView === "chat"} draft={chatDraft}
                            onDraftChange={setChatDraft} gameContext={gameContext}
                            onQuickAction={(kind) => {
                                if (kind === "sub") setSubRequested(true);
                                setChatDraft(getChatPrefill(kind, gameContext));
                            }} />
                    </Suspense>
                );

            case "manage-rsvps":
                if (!canManageRsvps) return null;
                return <RsvpManagement access={access} active={activeView === "manage-rsvps"}
                    onSaved={() => setRsvpRevision((value) => value + 1)} />;

            case "admin-email":
                if (!isAdmin) return null;
                return <AdminEmailView userId={session.user.id} active={activeView === "admin-email"} />;

            case "admin-schedule":
                if (!isAdmin) return null;
                return <AdminScheduleView />;

            case "admin-profiles":
                if (!isAdmin) return null;
                return <AdminProfilesView onProfileSaved={(updatedProfile) => {
                    if (updatedProfile.id === currentProfile.id) setCurrentProfile(updatedProfile);
                    setTeamRevision((revision) => revision + 1);
                }} />;

            case "admin-notice":
                if (!isAdmin) return null;
                return (
                    <AdminNoticeView
                        leagueName={currentLeagueName}
                        onNoticeChanged={() => loadLeagueNotice(currentLeagueName)}
                    />
                );

            default:
                return null
        }
    }

    if (isSetPasswordPage) {
        return <SetPassword />
    }   


    if (authLoading) {
        return <p>Checking account...</p>;
    }

    if (!session) {
        return <Login />;
    }

    if (!currentProfile) {
        return <Login accessDenied={accessDenied} />
    }

    return (
        <StreamSessionProvider userId={session.user.id}>
        <div className="app-layout">
            {leagueTicker && (
                <div className="league-ticker-bar">
                    <span className="league-ticker-icon">📣</span>
                    <span className="league-ticker-text">{leagueTicker.title}</span>
                </div>
            )}
            <header className="app-bar">
                <div className="app-bar-brand">
                    <button
                        type="button"
                        className="mobile-nav-button"
                        aria-label="Open navigation"
                        aria-expanded={isMobileNavOpen}
                        aria-controls="league-navigation"
                        onClick={() => setIsMobileNavOpen(true)}
                    >
                        <HockeyIcon size={22} />
                    </button>

                    <HockeyIcon 
                        size={22} 
                        className="app-bar-icon desktop-brand-icon" 
                    />

                    <div>
                        <h1 className="app-bar-title">Hockey League</h1>
                        <span className="app-bar-subtitle">
                            {currentLeagueName
                                ? `${currentLeagueName} · Season 2026`
                                : "Season 2026"}
                        </span>
                    </div>
                </div>
                <NextGameBanner
                    games={upcomingGames}
                    selectedIndex={nextGameIndex}
                    gameContext={gameContext}
                    onSelect={setNextGameIndex}
                />

                <button
                            type="button"
                            className="sign-out-button"
                            onClick={signOut}
                        >
                            Sign out
                        </button>
            </header>

            <div className="app-body">
                <nav
                    id="league-navigation"
                    className={`sidebar${isMobileNavOpen ? " is-open" : ""}`}
                    aria-label="League navigation"
                >
                    <div className="mobile-drawer-header">
                        <span>Menu</span>

                        <button
                            type="button"
                            className="mobile-nav-close"
                            aria-label="Close navigation"
                            onClick={() => setIsMobileNavOpen(false)}
                        >
                            x
                        </button>
                    </div>

                    {NAV_ITEMS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`sidebar-link${activeView === item.id ? " is-active" : ""}`}
                            onClick={() => navigateTo(item.id)}
                        >
                            {item.label}{item.id === "chat" && <ChatUnreadBadge />}
                        </button>
                    ))}

                    {isAdmin && (
                        <>
                            <div className="sidebar-section-label">Admin</div>
                            <button
                                type="button"
                                className={`sidebar-link${activeView === "admin-schedule" ? " is-active" : ""}`}
                                onClick={() => navigateTo("admin-schedule")}
                            >
                                Schedule
                            </button>
                            <button
                                type="button"
                                className={`sidebar-link${activeView === "admin-profiles" ? " is-active" : ""}`}
                                onClick={() => navigateTo("admin-profiles")}
                            >
                                Players
                            </button>
                            <button
                                type="button"
                                className={`sidebar-link${activeView === "admin-notice" ? " is-active" : ""}`}
                                onClick={() => navigateTo("admin-notice")}
                            >
                                Notice
                            </button>
                            <button
                                type="button"
                                className={`sidebar-link${activeView === "admin-email" ? " is-active" : ""}`}
                                onClick={() => navigateTo("admin-email")}
                            >
                                Email Members
                            </button>
                        </>
                    )}
                    {canManageRsvps && (
                        <button type="button" className={`sidebar-link${activeView === "manage-rsvps" ? " is-active" : ""}`}
                            onClick={() => navigateTo("manage-rsvps")}>Manage RSVPs</button>
                    )}
                </nav>

                {isMobileNavOpen && (
                    <button
                        type="button"
                        className="mobile-nav-backdrop"
                        aria-label="Close navigation"
                        onClick={() => setIsMobileNavOpen(false)}
                    />
                )}

                <main className="main-content" key={session.user.id}>
                    {managementError && <p role="alert">{managementError}</p>}
                    {[
                        ...NAV_ITEMS.map((item) => item.id),
                        ...(canManageRsvps ? ["manage-rsvps"] : []),
                        ...(isAdmin ? ["admin-schedule", "admin-profiles", "admin-notice", "admin-email"] : []),
                    ].map((view) => (
                        <SavedTab key={view} active={activeView === view}>
                            {() => renderView(view)}
                        </SavedTab>
                    ))}
                </main>

                {activeView !== "chat" && !(activeView === "teams" && selectedPlayer) && (
                    <TonightsRoster
                    game={upcomingGame}
                    myTeam={myTeam}
                    rsvpsByProfile={rsvpsByProfile}
                    onPromptPlayers={promptNoResponse}
                />
                )}
            </div>
        </div>
        </StreamSessionProvider>
    );
}

function GameRosterList({
    players = [],
    rsvpsByProfile = {},
    variant = "desktop",
    onRsvpChange,
    saving = false,
}) {
    return (
        <ul className="rail-roster-list">
            {players.map((player) => {
                const playerName = player.profiles?.full_name ?? player.name ?? "Unknown Player"

                const profileId = player.profile_id ?? player.profiles?.id

                const status = rsvpsByProfile[profileId] ?? "pending"

                const initials = playerName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()

                const editor = onRsvpChange && profileId ? (
                    <select value={status} disabled={saving}
                        aria-label={`RSVP for ${playerName}`}
                        onChange={(event) => onRsvpChange(player, event.target.value)}>
                        <option value="pending">No response</option>
                        <option value="going">Going</option>
                        <option value="maybe">Maybe</option>
                        <option value="out">Out</option>
                    </select>
                ) : null;

                if (variant == "mobile") {
                    return (
                        <li
                            key={player.id ?? profileId ?? playerName}
                            className={`mobile-roster-item rail-roster-item--${status}`}
                        >
                            <div className="mobile-roster-player">
                                <div className="roster-player-avatar">
                                    {initials}
                                </div>

                                <div className="mobile-roster-player-info">
                                    <strong>{playerName}</strong>
                                    <span>
                                        {{
                                            forward: "Forward",
                                            defense: "Defense",
                                            goalie: "Goalie",
                                            F: "Forward",
                                            D: "Defense",
                                            G: "Goalie",
                                        }[player.position] ?? player.position ?? "Position not provided"}
                                    </span>
                                </div>
                            </div>

                            {editor ?? <div
                                className={`mobile-roster-status mobile-roster-status--${status}`}
                                aria-label={rsvpLabel(status)}
                            >
                                {status === "going" && "✓"}
                                {status === "maybe" && "?"}
                                {status === "out" && "×"}
                                {status === "pending" && "—"}
                            </div>}
                        </li>
                    )
                }

                return (
                    <li
                        key={player.id ?? profileId ?? playerName}
                        className={`rail-roster-item rail-roster-item--${status}`}
                    >
                        <span className="rail-roster-player-name">
                            {playerName}
                        </span>

                        {editor ?? <span className={`text-${status}`}>
                            {rsvpLabel(status)}
                        </span>}
                    </li>
                )
            })}
        </ul>
    )
}

function GameRosterModal({
    game,
    myTeam,
    rsvpsByProfile = {},
    onClose,
}) {
    if (!game) {
        return null
    }

    const players = myTeam?.team_members ?? myTeam?.roster ?? []

    return (
        <div className="modal-backdrop mobile-roster-backdrop" onClick={onClose}>
            <section className="mobile-roster-modal" onClick={(event) => event.stopPropagation()}>
                <header className="mobile-roster-header">
                    <div>
                        <span className="col-label">
                            Game Roster
                        </span>

                        <h2>
                            {game.home_team_name} vs {" "}
                            {game.away_team_name}
                        </h2>
                    </div>

                    <button
                        type="button"
                        className="modal-close"
                        onClick={onClose}
                    >
                        Close
                    </button>
                </header>

                <div className="mobile-roster-game-info">
                    <span>
                        {formatGameDate(game.game_date)}
                    </span>

                    <span>
                        {formatGameTime(game.start_time)}
                    </span>

                    <span>
                        {game.location}
                        {game.rink
                            ? ` · ${game.rink}`
                            : ""}
                    </span>
                </div>

                <div className="mobile-roster-summary">
                    {Object.values(rsvpsByProfile).filter(
                        (status) => status === "going"
                    ).length} players going
                </div>

                {players.length === 0 ? (
                    <p className="empty-state">
                        No roster loaded.
                    </p>
                ) : (
                    <GameRosterList
                        players={players}
                        rsvpsByProfile={rsvpsByProfile}
                        variant="mobile"
                    />
                )}

            </section>
        </div>
    )
}

function DashboardView({
    currentUserId,
    gameContext,
    myTeam,
    userRsvp,
    onRsvp,
    subRequested,
    onRequestSub,
    onMessageTeam,
    onPromptNoResponse,
    onOpenTeam,
    onViewSchedule,
    feedItems,
    expandedFeedId,
    onToggleFeed,
    teams,
    games,
    mobileGameContexts = [],
    mobileRsvpsByProfileByGame = {},
    onMobileRsvp,
    leagueNotice = null,
}) {
    const subStatus = formatSubStatus(myTeam?.substituteStatus, subRequested);
    const noResponse = gameContext?.noResponse ?? 0;
    const attendanceDetail = gameContext ? formatAttendanceDetail(gameContext) : "";

    const [gameActionsOpen, setGameActionsOpen] = useState(false);

    const [rosterGame, setRosterGame] = useState(null) // not duplicate data state - tracks which mobile game did the user tap "View Roster"
    return (
        <div className="page-view dashboard-view">
            <header className="page-header">
                <h2>Dashboard</h2>
            </header>

            <div className="dashboard-grid">
                <div className="desktop-next-game">
                {gameContext ? (
                    <section className="content-card next-game-card content-card--hero">
                        <header className="content-card-header"><h2>Next Game</h2></header>
                        <div className="next-game-columns">
                            <div className="next-game-col next-game-col--info">
                                <div className="next-game-matchup">{gameContext.matchup}</div>
                                <p className="next-game-when">
                                    {gameContext.date} · {gameContext.time} · {gameContext.rink}
                                </p>
                            </div>
                            <div className="next-game-col next-game-col--attendance">
                                <span className="attendance-hero-number dashboard-attendance-counts">{gameContext.skatersGoing} skaters · <strong>{gameContext.goaliesGoing} {gameContext.goaliesGoing === 1 ? "goalie" : "goalies"}</strong></span>
                                {attendanceDetail && (
                                    <p className="attendance-detail-line">{attendanceDetail}</p>
                                )}
                                {gameContext.subsNeeded && (
                                    <p className="attendance-status-line">{subStatus}</p>
                                )}
                            </div>
                            <div className="next-game-col next-game-col--actions">
                                {myTeam?.canRsvp ? <>
                                    <span className="col-label">Your Status</span>
                                    <p className="your-status">
                                        Currently <strong className={`text-${userRsvp}`}>{rsvpLabel(userRsvp)}</strong>
                                    </p>
                                    <RsvpControls value={userRsvp} onChange={onRsvp} size="large" />
                                </> : <p className="your-status">Viewing spare team's schedule and roster</p>}
                                <div className="action-stack action-stack--mobile">
                                    <button type="button" className="action-btn action-btn--primary" onClick={onMessageTeam}>Message Team</button>
                                    <div className="game-more-actions">
                                        <button 
                                            type="button" 
                                            className="game-more-button" 
                                            onClick={() => setGameActionsOpen((open) =>  !open)}
                                            aria-label="More game actions"
                                            aria-expanded={gameActionsOpen}
                                        >
                                             ⋮
                                        </button>

                                        {gameActionsOpen && (
                                            <div className="game-actions-menu">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setGameActionsOpen(false);
                                                        onViewSchedule();
                                                    }}
                                                >
                                                    View Schedule
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setGameActionsOpen(false);
                                                        onRequestSub();
                                                    }}
                                                >
                                                    Request Sub
                                                </button>

                                                {noResponse > 0 && (
                                                    <button 
                                                        type="button" 
                                                        onClick={() => {
                                                            setGameActionsOpen(false);
                                                            onPromptNoResponse();
                                                        }}
                                                    >
                                                        Prompt No Response
                                                    </button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>    
                    </section>
                ) : (
                    <section className="content-card"><p className="empty-state">No upcoming games.</p></section>
                )}
                </div>

                <div className="mobile-next-games">
                    {mobileGameContexts.length > 0 ? (
                        <div className="mobile-game-carousel">
                            {mobileGameContexts.map(
                                ({ game, context, userRsvp: mobileUserRsvp }) => (
                                    <section
                                        key={game.id}
                                        className="content-card next-game-card content-card--hero mobile-game-slide"
                                    >
                                    <header className="content-card-header">
                                        <h2>Next Game</h2>
                                    </header>

                                    <div className="next-game-columns">
                                        <div className="next-game-col next-game-col--info">
                                            <div className="next-game-matchup">
                                                {context.matchup}
                                            </div>

                                            <p className="next-game-when">
                                                {context.date} · {context.time} · {context.rink}
                                            </p>
                                        </div>

                                        <div className="next-game-col next-game-col--attendance">
                                            <span className="attendance-hero-number dashboard-attendance-counts">
                                                {context.skatersGoing} skaters · <strong>{context.goaliesGoing} {context.goaliesGoing === 1 ? "goalie" : "goalies"}</strong>
                                            </span>
                                        </div>

                                        <div className="next-game-col next-game-col--actions">
                                            {myTeam?.canRsvp ? <>
                                                <span className="col-label">Your Status</span>
                                                <p className="your-status">Currently <strong className={`text-${mobileUserRsvp}`}>{rsvpLabel(mobileUserRsvp)}</strong></p>
                                                <RsvpControls value={mobileUserRsvp} onChange={(status) => onMobileRsvp(game, status)} size="large" />
                                            </> : <p className="your-status">Viewing spare team's schedule and roster</p>}

                                            <div className="action-stack action-stack--mobile">
                                                <button
                                                    type="button"
                                                    className="action-btn action-btn--primary"
                                                    onClick={onMessageTeam}
                                                >
                                                    Message Team
                                                </button>

                                                <div className="game-more-actions">
                                                    <button
                                                        type="button"
                                                        className="game-more-button"
                                                        onClick={() =>
                                                            setGameActionsOpen(
                                                                (open) => !open
                                                            )
                                                        }
                                                        aria-label="More game actions"
                                                        aria-expanded={gameActionsOpen}
                                                    >
                                                        ⋮
                                                    </button>

                                                    {gameActionsOpen && (
                                                        <div className="game-actions-menu">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setGameActionsOpen(false);
                                                                    onViewSchedule(game);
                                                                }}
                                                            >
                                                                View Schedule
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setGameActionsOpen(false)
                                                                    setRosterGame(game)
                                                                }}
                                                            >
                                                                View Roster
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setGameActionsOpen(false);
                                                                    onRequestSub();
                                                                }}
                                                            >
                                                                Request Sub
                                                            </button>

                                                            {context.noResponse > 0 && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setGameActionsOpen(false);
                                                                        onPromptNoResponse();
                                                                    }}
                                                                >
                                                                    Prompt No Response
                                                                </button>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </section>
                            )
                        )}
                    </div>
                ) : (
                    <section className="content-card">
                        <p className="empty-state">
                            No upcoming games.
                        </p>
                    </section>
                )}
            </div>

                <LeagueFeed
                    items={feedItems}
                    limit={4}
                    expandedId={expandedFeedId}
                    onToggle={onToggleFeed}
                    title="Recent Updates"
                />

                <section className="content-card teams-overview">
                    <header className="content-card-header">
                        <h2>Teams</h2>
                    </header>
                    <div className="teams-grid">
                        {teams.map((team) => (
                            <TeamCard
                                key={team.id}
                                team={team}
                                games={games}
                                teams={teams}
                                onSelect={onOpenTeam}
                                compact
                            />
                        ))}
                    </div>
                </section>
                {rosterGame && (
                    <GameRosterModal
                        game={rosterGame}
                        myTeam={myTeam}
                        rsvpsByProfile={
                            mobileRsvpsByProfileByGame[
                                rosterGame.id
                            ] ?? {}
                        }
                        onClose={() => setRosterGame(null)}
                    />
                )}
            </div>

            {leagueNotice && (
                <div className="league-notice-banner">
                    <div className="league-notice-banner-content">
                        <span className="league-notice-banner-icon">📢</span>
                        <div className="league-notice-banner-text">
                            <strong className="league-notice-banner-title">{leagueNotice.title}</strong>
                            {leagueNotice.message && (
                                <p className="league-notice-banner-message">{leagueNotice.message}</p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function TeamCard({ team, games, teams, onSelect, compact = false }) {
    const roster = team.team_members ?? [];

    const forwards = roster.filter((member) =>
        ["f", "forward"].includes(
            member.position?.trim().toLowerCase()
        )
    ).length;

    const defense = roster.filter((member) =>
        ["d", "defense"].includes(
            member.position?.trim().toLowerCase()
        )
    ).length;

    const goalies = roster.filter((member) =>
        ["g", "goalie", "goaltender"].includes(
            member.position?.trim().toLowerCase()
        )
    ).length;

    return (
        <article className="team-card team-card--clickable">
            <div className="team-card-head">
                <h3 className="team-card-name">{team.name}</h3>
                <span className="team-card-count">{roster.length} players</span>
            </div>

            <p className="team-card-next">
                Forwards: {forwards} · Defense: {defense} · Goalies: {goalies}
            </p>

            <button
                type="button"
                className="team-card-link"
                onClick={() => onSelect(team)}
            >
                View roster →
            </button>
        </article>
    );
}

function ScheduleView({
    access,
    onRsvpSaved,
    requestedDetailGame = null,
    myTeam,
    currentTeamId,
    onMessageTeam,
    onRequestSub,
    onMobileRsvp,
    mobileRsvpsByGame,
    mobileAttendanceByGame,
}) {
    const [games, setGames] = useState([])
    const [detailGame, setDetailGame] = useState(requestedDetailGame);
    const [rsvpGameId, setRsvpGameId] = useState(null);
    const [calendarDate, setCalendarDate] = useState(() => {
        if (!requestedDetailGame?.game_date) return new Date();
        const [year, month, day] = requestedDetailGame.game_date.split("-").map(Number);
        return new Date(year, month - 1, day);
    });

    const [lastDetailRequest, setLastDetailRequest] = useState(requestedDetailGame);

    // SavedTab keeps Schedule mounted, so handle every new navigation request.
    if (requestedDetailGame !== lastDetailRequest) {
        setLastDetailRequest(requestedDetailGame);
        if (requestedDetailGame) {
            setDetailGame(requestedDetailGame);
            setRsvpGameId(null);
            const [year, month, day] = requestedDetailGame.game_date.split("-").map(Number);
            setCalendarDate(new Date(year, month - 1, day));
        }
    }

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth();

    function goToPreviousMonth() {
        setCalendarDate((current) =>
            new Date(
                current.getFullYear(),
                current.getMonth() - 1,
                1
            )
        );
    }

    function goToNextMonth() {
        setCalendarDate((current) =>
            new Date(
                current.getFullYear(),
                current.getMonth() + 1,
                1
            )
        );
    }

    function goToCurrentMonth() {
        setCalendarDate(new Date());
    }

    useEffect(() => {
        if (!myTeam?.id) {
            setGames([]);
            setRsvpGameId(null);
            return;
        }

        let cancelled = false;
        setGames([]);
        setRsvpGameId(null);
        async function loadGames() {
            const { data, error } = await supabase
                .from('games')
                .select('*')
                .or(`home_team_id.eq.${myTeam.id},away_team_id.eq.${myTeam.id}`)
                .order('starts_at', { ascending: true });

            if (error) {
                console.error(error);
                return;
            }

            if (!cancelled) setGames(filterGamesForTeam(data ?? [], myTeam.id));
        }

        loadGames();
        return () => { cancelled = true; };
    }, [myTeam?.id]);

    // Desktop version of Schedule - Calendar

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const calendarStart = new Date(firstDayOfMonth);
    calendarStart.setDate(
        firstDayOfMonth.getDate() - firstDayOfMonth.getDay()
    );

    const calendarEnd = new Date(lastDayOfMonth);
    calendarEnd.setDate(
        lastDayOfMonth.getDate() + (6 - lastDayOfMonth.getDay())
    );

    const calendarDays = []

    const cursor = new Date(calendarStart);

    while (cursor <= calendarEnd) {
        calendarDays.push(new Date(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }

    return (
        <div className="page-view schedule-view">
            <header className="page-header schedule-page-header">
                <div>
                    <h2>Schedule</h2>
                    <p className="page-subtitle">{games.length} games · South Suburban Sports Complex</p>
                </div>
                <button
                    type="button"
                    className="action-btn action-btn--secondary"
                    onClick={() => downloadScheduleIcs(games, myTeam?.name)}
                    disabled={games.length === 0}
                >
                    Export calendar (.ics)
                </button>
            </header>
            <div className="desktop-schedule">
            <section className="content-card schedule-calendar">
                <div className="schedule-calendar-toolbar">
                    <h3>
                        {calendarDate.toLocaleDateString("en-US", {
                            month: "long",
                            year: "numeric",
                        })}
                    </h3>

                <div className="schedule-calendar-actions">
                    <button
                        type="button"
                        className="action-btn action-btn--secondary"
                        onClick={goToPreviousMonth}
                    >
                        ←
                    </button>

                    <button
                        type="button"
                        className="action-btn action-btn--secondary"
                        onClick={goToCurrentMonth}
                    >
                        Today
                    </button>

                    <button
                        type="button"
                        className="action-btn action-btn--secondary"
                        onClick={goToNextMonth}
                    >
                        →
                    </button>
                </div>
            </div>

            <div className="schedule-calendar-weekdays">
                {[
                    "Sun",
                    "Mon",
                    "Tue",
                    "Wed",
                    "Thu",
                    "Fri",
                    "Sat",
                ].map((day) => (
                    <div key={day}>{day}</div>
                ))}
            </div>

            <div className="schedule-calendar-grid">
                {calendarDays.map((day) => {
                    const dateKey = formatDateKey(day);

                    const dayGames = games.filter(
                        (game) => game.game_date === dateKey
                    );

                    const isCurrentMonth = day.getMonth() === month;

                    const isToday = formatDateKey(day) === formatDateKey(new Date());

                    return (
                        <div
                            key={dateKey}
                            className={[
                                "schedule-calendar-day",
                                !isCurrentMonth
                                    ? "is-outside-month"
                                    : "",
                                isToday ? "is-today" : "",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                        >
                            <div className="schedule-calendar-date">
                                {day.getDate()}
                            </div>

                            <div className="schedule-calendar-games">
                                {dayGames.map((game) => {
                                    // Get the current user's RSVP for this game
                                    const gameRsvp =
                                        mobileRsvpsByGame[game.id] ?? "pending";

                                    // Get the current attendance counts for this game
                                    const attendance =
                                        mobileAttendanceByGame[game.id] ?? {
                                            going: 0,
                                            maybe: 0,
                                            out: 0,
                                            noResponse: 0,
                                        };

                                    const showRsvp = rsvpGameId === game.id;

                                    const canRsvp = canRsvpToGame(game, currentTeamId);

                                    return (
                                    <div
                                        key={game.id}
                                        className="schedule-calendar-game"
                                    >
                                        <button
                                            type="button"
                                            className="schedule-calendar-game-main"
                                            onClick={() =>
                                                setDetailGame(game)
                                            }
                                        >
                                            <span className="schedule-calendar-game-time">
                                                {formatGameTime(
                                                    game.start_time
                                                )}
                                            </span>

                                            <span className="schedule-calendar-game-teams">
                                                {
                                                    game.home_team_name
                                                }{" "}
                                                vs{" "}
                                                {
                                                    game.away_team_name
                                                }
                                            </span>

                                            <span className="schedule-calendar-game-rink">
                                                {
                                                    game.location_name
                                                }
                                                {game.rink
                                                    ? ` · ${game.rink}`
                                                    : ""}
                                            </span>

                                            <span
                                                className={`schedule-calendar-rsvp text-${gameRsvp}`}
                                            >
                                                {rsvpLabel(gameRsvp)}
                                            </span>
                                        </button>

                                        <div className="schedule-calendar-rsvp-wrap">
                                            {canRsvp && (
                                                <button
                                                type="button"
                                                className="schedule-calendar-rsvp-button"
                                                onClick={() =>
                                                    setRsvpGameId(showRsvp ? null : game.id)
                                                }
                                            >
                                                RSVP
                                                </button>
                                            )}

                                            {canRsvp && showRsvp && (
                                                <div className="schedule-calendar-rsvp-popover">
                                                    <span className="col-label">
                                                        Your RSVP
                                                    </span>

                                            <RsvpControls
                                                value={gameRsvp}
                                                onChange={(status) => {
                                                    onMobileRsvp(game, status);
                                                    setRsvpGameId(null);
                                                }}
                                            />

                                            <span className="schedule-calendar-attendance">
                                                {attendance.going}G ·{" "}
                                                {attendance.maybe}M ·{" "}
                                                {attendance.out}O
                                            </span>
                                        </div>
                                    )}
                                </div>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    </section>
    </div>
    
    {/* Mobile schedule: compact chronological agenda list */}
    <div className="mobile-schedule">
    <section className="content-card mobile-schedule-list">
        <div className="mobile-schedule-games">
            {games.length > 0 ? (
                games.map((game, index) => {
                    // Get the current user's RSVP for this game
                    const gameRsvp =
                        mobileRsvpsByGame[game.id] ?? "pending";

                    // Get the current attendance counts for this game
                    const attendance =
                        mobileAttendanceByGame[game.id] ?? {
                            going: 0,
                            maybe: 0,
                            out: 0,
                            noResponse: 0,
                        };
                
                    const showRsvp = rsvpGameId === game.id;

                    const canRsvp = canRsvpToGame(
                        game,
                        currentTeamId
                    );

                    const gameDate = new Date(`${game.game_date}T00:00:00`);

                    // Compare this game to the previous  one so we know
                    // when to display a new month heading
                    const previousGame = index > 0 ? games[index - 1] : null;

                    const previousGameDate = previousGame
                        ? new Date(`${previousGame.game_date}T00:00:00`) : null;
                    const showMonthHeading = 
                        !previousGameDate || 
                        previousGameDate.getMonth() !== 
                            gameDate.getMonth() ||
                        previousGameDate.getFullYear() !==
                            gameDate.getFullYear();
                    
                    return (
                        <div key={game.id}>
                            {showMonthHeading && (
                                <h3 className="mobile-schedule-month">
                                    {gameDate.toLocaleDateString(
                                        "en-US",
                                        {
                                            month: "long",
                                            year: "numeric",
                                        }
                                    )}
                                </h3>
                            )}

                            <div className="mobile-schedule-game">
                                {/* Game date */}
                                <div className="mobile-schedule-date">
                                    <span className="mobile-schedule-date-number">
                                        {gameDate.getDate()}
                                    </span>

                                    <span className="mobile-schedule-date-day">
                                        {gameDate.toLocaleDateString(
                                            "en-US",
                                            {
                                                weekday: "short",
                                            }
                                        )}
                                    </span>
                                </div>

                                {/* Game information */}
                                <button
                                    type="button"
                                    className="mobile-schedule-game-main"
                                    onClick={() => setDetailGame(game)}
                                >
                                    <span className="mobile-schedule-game-time">
                                        {formatGameTime(game.start_time)}
                                    </span>

                                    <span className="mobile-schedule-game-matchup">
                                        {game.home_team_name} vs {" "}
                                        {game.away_team_name}
                                    </span>

                                    <span className="mobile-schedule-game-rink">
                                        {game.location_name}
                                        {game.rink ? ` · ${game.rink}` : ""}
                                    </span> 
                                </button>

                                {/* RSVP status */}
                                {canRsvp && (
                                <div className="mobile-schedule-rsvp">
                                    <button
                                        type="button"
                                        className={`mobile-schedule-rsvp-status mobile-schedule-rsvp-status--${gameRsvp}`}
                                        onClick={() =>
                                            setRsvpGameId(
                                                showRsvp
                                                    ? null
                                                    : game.id
                                            )
                                         }
                                         aria-label={`RSVP: ${rsvpLabel(gameRsvp)}`}
                                    >
                                        {gameRsvp === "going" && "✓"}
                                        {gameRsvp === "maybe" && "?"}
                                        {gameRsvp === "out" && "×"}
                                        {gameRsvp === "pending" && "?"}
                                    </button>

                                    {showRsvp && (
                                        <div className="mobile-schedule-rsvp-popover">
                                            <span className="col-label">
                                                Your RSVP
                                            </span>

                                            <RsvpControls
                                                value={gameRsvp}
                                                onChange={(status) => {
                                                    onMobileRsvp(game, status);
                                                    setRsvpGameId(null);
                                                }}
                                            />

                                            <span className="schedule-calendar-attendance">
                                                {attendance.going}G ·{" "}
                                                {attendance.maybe}M ·{" "}
                                                {attendance.out}O
                                            </span>
                                        </div>
                                    )}
                                </div>
                                )}
                            </div>
                        </div>
                    );
                })
            ) : (
                <p className="empty-state">
                    No upcoming games.
                </p>
            )}
        </div>
    </section>
    </div>

            {detailGame && (
                <GameDetailModal
                    access={access}
                    onRsvpSaved={onRsvpSaved}
                    game={detailGame}
                    key={detailGame.id}
                    onClose={() => setDetailGame(null)}
                    onMessageTeam={() => {
                         setDetailGame(null); 
                         onMessageTeam(); 
                    }}
                    onRequestSub={() => { 
                        setDetailGame(null); 
                        onRequestSub(); 
                    }}
                />
            )}
        </div>
    );
}

function TeamsView({ teams = [], onSelectTeam }) {
    return (
        <div className="page-view teams-view">
            <header className="page-header">
                <h2>Teams</h2>
                <p className="page-subtitle">
                    League teams and player rosters
                </p>
            </header>

            <div className="teams-grid teams-grid--page">
                {teams.map((team) => (
                    <TeamCard
                        key={team.id}
                        team={team}
                        onSelect={onSelectTeam}
                    />
                ))}
            </div>
        </div>
    )
}

function TeamDetail({ team, teams, games, currentUserId, league, userRsvp, onBack, onSelectPlayer, onSponsorImageUpdated }) {

    const [sponsorFile, setSponsorFile] = useState(null)
    const [sponsorPreviewUrl, setSponsorPreviewUrl] = useState(
        team?.sponsor_image_url ?? ''
    )   

    const [isEditingSponsor, setIsEditingSponsor] = useState(false)
    const [sponsorImageUrl, setSponsorImageUrl] = useState(
        team?.sponsor_image_url ?? ''
    )
    const [isSavingSponsor, setIsSavingSponsor] = useState(false)
    const [sponsorError, setSponsorError] = useState('')

    const roster = Array.isArray(team?.team_members)
    ? [...team.team_members].sort((a, b) => {
        const aName = a.profiles?.full_name ?? '';
        const bName = b.profiles?.full_name ?? '';

        return aName.localeCompare(bName);
       })
    :  []


    useEffect(() => {
        setSponsorImageUrl(team?.sponsor_image_url ?? '')
        setSponsorPreviewUrl(team?.sponsor_image_url ?? '')
        setSponsorFile(null)
        setIsEditingSponsor(false)
        setSponsorError('') 
    }, [team?.id, team?.sponsor_image_url])

    async function saveSponsorImage() {
        setIsSavingSponsor(true)
        setSponsorError('')

        let savedUrl = team.sponsor_image_url ?? null

        if (sponsorFile) {
            const extension =
                sponsorFile.name.split('.').pop()?.toLowerCase() || 'png'

            const filePath =
                `${team.id}/sponsor-${Date.now()}.${extension}`

            const { error: uploadError } = await supabase.storage
                .from('team-assets')
                .upload(filePath, sponsorFile, {
                    cacheControl: '3600',
                    upsert: true
                })
            
            if (uploadError) {
                console.error(
                    'Error uploading sponsor image:',
                    uploadError
                )
                setSponsorError('Unable to upload the sponsor image.')
                setIsSavingSponsor(false)
                return
            }

            const { data: publicUrlData } = supabase.storage
                .from('team-assets')
                .getPublicUrl(filePath)

            savedUrl = publicUrlData.publicUrl
        }

        const { error: updateError } = await supabase
            .from('teams')
            .update({
                sponsor_image_url: savedUrl
            })
            .eq('id', team.id)
        
        if (updateError) {
            console.error(
                "Error updating sponsor image:", 
                updateError
            )
            setSponsorError("Unable to update the sponsor image.")
            setIsSavingSponsor(false)
            return
        }

        onSponsorImageUpdated?.(team.id, savedUrl)

        setSponsorFile(null)
        setSponsorPreviewUrl(savedUrl ?? '')
        setIsEditingSponsor(false)
        setIsSavingSponsor(false)
    }


    return (
        <div className="page-view team-detail-view">
            <button type="button" className="back-button" onClick={onBack}>← Back to teams</button>

            <header className="page-header">
                <h2>{team.name}</h2>
                <p className="page-subtitle">{roster.length} players</p>
            </header>

            <div className="team-sponsor-section">
                {team.sponsor_image_url && !isEditingSponsor && (
                    <div className="team-sponsor-banner">
                        <img
                            src={team.sponsor_image_url}
                            alt={`${team.name} sponsors`}
                        />
                    </div>
                )}

            {!isEditingSponsor ? (
                <button
                    type="button"
                    className="sponsor-edit-button"
                    onClick={() => setIsEditingSponsor(true)}
                >
                    {team.sponsor_image_url
                        ? 'Edit sponsor image'
                        : 'Add sponsor image'}
                </button>
            ) : (
                <div className="sponsor-image-editor">
                    <label className="form-field">
                        <span>Sponsor image</span>
                        <p className="field-help">For best results, upload a wide banner image. Recommended size: 1200 × 300 pixels.</p>

                        <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                                const file = event.target.files?.[0]

                                if (!file) {
                                    return
                                }

                                if (file.size > 5 * 1024 * 1024) {
                                    setSponsorError(
                                        "Choose an image smaller than 5 MB."
                                    )
                                    return
                                }
                                setSponsorFile(file)
                                setSponsorPreviewUrl(URL.createObjectURL(file))
                                setSponsorError('')
                            }}
                        />
                    </label>

                    {sponsorPreviewUrl && (
                        <div className="sponsor-image-preview">
                            <p>Preview</p>

                            <img
                                src={sponsorPreviewUrl}
                                alt="Sponsor banner preview"
                                onError={() => {
                                    setSponsorError(
                                        "The selected image could not be previewed."
                                    )
                                }}
                                onLoad={() => setSponsorError('')}
                            />
                        </div>
                    )}

                    {sponsorError && (
                        <p className="form-error">{sponsorError}</p>
                    )}

                    <div className="sponsor-form-actions">
                        <button
                            type="button"
                            className="button button-primary"
                            disabled={isSavingSponsor || Boolean(sponsorError)}
                            onClick={saveSponsorImage}
                        >

                            {isSavingSponsor ? 'Saving...' : 'Save'}
                        </button>

                        <button
                            type="button"
                            className="button button-secondary"
                            disabled={isSavingSponsor}
                            onClick={() => {
                                setSponsorFile(null)
                                setSponsorPreviewUrl(
                                    team.sponsor_image_url ?? ''
                                )
                                setSponsorError('')
                                setIsEditingSponsor(false)
                            }}
                        >
                            Cancel
                        </button>

                        {team.sponsor_image_url && (
                            <button
                                type="button"
                                className="button button-danger"
                                disabled={isSavingSponsor}
                                onClick={async () => {
                                    setIsSavingSponsor(true)
                                    setSponsorError('')

                                    const { error: removeError } = await supabase
                                        .from('teams')
                                        .update({
                                            sponsor_image_url: null
                                        })
                                        .eq('id', team.id)
                                    
                                    if (removeError) {
                                        console.error(
                                            "Unable to remove the sponsor image."
                                        )
                                        setIsSavingSponsor(false)
                                        return
                                    }

                                    onSponsorImageUpdated?.(team.id, null)
                                    setSponsorPreviewUrl('')
                                    setIsEditingSponsor(false)
                                    setIsSavingSponsor(false)
                                }}
                            >
                                Remove image
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div> 


        <section className="content-card roster-card">
            <header className="content-card-header"><h2>Roster</h2></header>
            <table className="roster-table">
                <thead>
                    <tr><th>Name</th><th>#</th><th>Position</th></tr>
                </thead>
                <tbody>
                    {roster.map((member) => (
                            <tr key={member.id} onClick={() => onSelectPlayer(member)}>
                                <td className="roster-name">
                                    <div className="team-roster-player">
                                        <div className="team-roster-avatar">
                                            {(
                                                member.profiles?.full_name ?? 'Unknown player'
                                            ).split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                                        </div>
                                        <span>
                                            {member.profiles?.full_name ?? "Unknown player"}
                                        </span>
                                    </div>
                                </td>
                                <td>{member.jersey_number}</td>
                                <td>
                                    {{
                                        forward: "Forward",
                                        defense: "Defense",
                                        goalie: "Goalie",
                                        F: "Forward",
                                        D: "Defense",
                                        G: "Goalie",
                                    }[member.position] ?? member.position}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        <section className="content-card roster-card">
            <header className="content-card-header"><h2>Spares</h2></header>
            {(team.spares ?? []).length === 0 && <p>No spare players selected this team.</p>}
            <table className="roster-table">
                <thead>
                    <tr><th>Name</th><th>#</th><th>Position</th></tr>
                </thead>
                <tbody>
                    {(team.spares ?? []).map((member) => (
                            <tr key={member.id} onClick={() => onSelectPlayer(member)}>
                                <td className="roster-name">
                                    <div className="team-roster-player">
                                        <div className="team-roster-avatar">
                                            {(
                                                member.profiles?.full_name ?? 'Unknown player'
                                            ).split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase()}
                                        </div>
                                        <span>
                                            {member.profiles?.full_name ?? "Unknown player"}
                                        </span>
                                    </div>
                                </td>
                                <td>{member.jersey_number}</td>
                                <td>
                                    {{
                                        forward: "Forward",
                                        defense: "Defense",
                                        goalie: "Goalie",
                                        F: "Forward",
                                        D: "Defense",
                                        G: "Goalie",
                                    }[member.position] ?? member.position}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </section>
        </div>
    );
}

function PlayerDetail({ player, userRsvp, currentUserId, onBack }) {
    const status = resolveRsvp(player, userRsvp, currentUserId);
    return (
        <div className="page-view player-detail-view">
            <button type="button" className="back-button" onClick={onBack}>← Back to roster</button>
            <header className="page-header">
                <h2>{player.name}</h2>
                <p className="page-subtitle">#{player.number} · {player.position}{player.isGoalie ? " · Goalie" : ""}</p>
            </header>
            <section className="content-card">
                <header className="content-card-header"><h2>Contact</h2></header>
                <dl className="detail-dl">
                    <div><dt>Phone</dt><dd>{player.phone}</dd></div>
                    <div><dt>Email</dt><dd>{player.email}</dd></div>
                    <div><dt>Notes</dt><dd>{player.notes || "No notes yet"}</dd></div>
                </dl>
            </section>
        </div>
    );
}

function NoticesView({
    alerts,
    alertsLoading,
    alertsError,
    feedItems,
    expandedNoticeId,
    onToggleNotice,
    expandedFeedId,
    onToggleFeed,
    onViewGame,

    canCreateAnnouncement,
    announcementFormOpen,
    announcementDraft,
    announcementSubmitting,
    announcementSubmitError,
    onOpenAnnouncementForm,
    onCloseAnnouncementForm,
    onAnnouncementDraftChange,
    onCreateAnnouncement,

    }) {

    return (
        <div className="page-view notices-view">
            <header className="page-header notices-page-header">
                <div>
                    <h2>League Notices</h2>
                    <p className="page-subtitle">
                        Official announcements and schedule changes
                    </p>
                </div>
            </header>
            {canCreateAnnouncement && announcementFormOpen && (
                <section className="content-card announcement-form-card">
                    <header className="content-card-header">
                        <div>
                            <h2>New Announcement</h2>
                            <p className="page-subtitle">
                                Publish a message to everyone in the league.
                            </p>
                        </div>
                    </header>

                    <form
                        className="announcement-form"
                        onSubmit={onCreateAnnouncement}
                    >
                        <label className="form-field">
                            <span>Title</span>
                            <input
                                type="text"
                                value={announcementDraft.title}
                                maxLength={120}
                                required
                                onChange={(event) =>
                                onAnnouncementDraftChange({
                                ...announcementDraft,
                                title: event.target.value,
                            })
                        }
                    />
                </label>

                <label className="form-field">
                    <span>Summary</span>
                    <input
                        type="text"
                        value={announcementDraft.summary}
                        maxLength={180}
                        placeholder="Optional short description"
                        onChange={(event) =>
                            onAnnouncementDraftChange({
                                ...announcementDraft,
                                summary: event.target.value,
                            })
                        }
                    />
                </label>

                <label className="form-field">
                    <span>Message</span>
                    <textarea
                        value={announcementDraft.message}
                        rows={5}
                        required
                        onChange={(event) =>
                            onAnnouncementDraftChange({
                                ...announcementDraft,
                                message: event.target.value,
                            })
                        }
                    />
                </label>

                {announcementSubmitError && (
                    <p className="form-error">
                        {announcementSubmitError}
                    </p>
                )}

                <div className="form-actions">
                    <button
                        type="button"
                        className="action-btn action-btn--outline"
                        onClick={onCloseAnnouncementForm}
                        disabled={announcementSubmitting}
                    >
                        Cancel
                    </button>

                    <button
                        type="submit"
                        className="action-btn action-btn--primary"
                        disabled={announcementSubmitting}
                    >
                        {announcementSubmitting
                            ? "Publishing..."
                            : "Publish announcement"}
                    </button>
                </div>
            </form>
        </section>
    )}          

            <div>
                    {canCreateAnnouncement && (
                <button
                    type="button"
                    className="action-btn action-btn--primary"
                    onClick={onOpenAnnouncementForm}
                >
                    Create announcement
                </button>
                )}
            </div>
            <section className="content-card">
                <header className="content-card-header">
                        <h2>Announcements</h2>
                        <span className="content-card-meta">
                            {alerts.length} {alerts.length === 1 ? "notice" : "notices"}
                        </span>
                </header>
                {alertsLoading ? (
                    <p className="empty-state">Loading announcements...</p>
                ) : alertsError ? (
                    <p className="empty-state">{alertsError}</p>
                ) : alerts.length === 0 ? (
                    <p className="empty-state">No league announcements.</p>
                ) : (
                    alerts.map((alert) => {
                        const expanded = expandedNoticeId === alert.id;
                        return (
                            <div key={alert.id} className="notice-expandable">
                                <button type="button" className="notice-toggle" onClick={() => onToggleNotice(expanded ? null : alert.id)}>
                                    <time className="notice-date">{alert.date}</time>
                                    <strong className="notice-title">{alert.title}</strong>
                                    <span className="notice-summary">{alert.summary ?? alert.message}</span>
                                    {expanded ? (
                                        <IconChevronDown size={16} />
                                    ) : (
                                        <IconChevronRight size={16} />
                                    )}
                                </button>

                                {expanded && (
                                    <div className="notice-expanded">
                                        <p className="notice-message">{alert.message}</p>
                                        <span className="notice-meta">Posted {alert.date}</span>
                                        {alert.relatedGameId && (
                                            <button type="button" className="action-btn action-btn--ghost action-btn--sm" onClick={onViewGame}>View game</button>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </section>
            <LeagueFeed
                items={feedItems}
                expandedId={expandedFeedId}
                onToggle={onToggleFeed}
            />
        </div>
    );
}

export default App;
