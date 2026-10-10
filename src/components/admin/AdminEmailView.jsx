import { useEffect, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import { sendAdminEmail, emailRequestId } from "../../lib/adminEmail.js";
import { groupEmailRecipients } from "../../utils/emailRecipients.js";

const hasEmail = (profile) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email?.trim() ?? "");

const emailFunctionName = "send-admin-email";

export default function AdminEmailView({ userId, active }) {
    const [profiles, setProfiles] = useState([]);
    const [teams, setTeams] = useState([]);
    const [memberships, setMemberships] = useState([]);
    const [captainIds, setCaptainIds] = useState(new Set());
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [search, setSearch] = useState("");
    const [captainsOnly, setCaptainsOnly] = useState(false);
    const [subject, setSubject] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [sending, setSending] = useState(false);
    const [revision, setRevision] = useState(0);
    const [history, setHistory] = useState([]);
    const [historyError, setHistoryError] = useState("");
    const [historyRevision, setHistoryRevision] = useState(0);
    const [cooldown, setCooldown] = useState(0);
    const submitting = useRef(false);
    const requestKey = `admin-email-request:${userId}`;

    useEffect(() => {
        if (!cooldown) return;
        const timer = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
        return () => clearTimeout(timer);
    }, [cooldown]);

    useEffect(() => {
        if (!active) return;
        let cancelled = false;
        let timer;
        let refreshing = false;
        let refreshes = 0;
        let hasPending = true;

        async function refresh() {
            if (cancelled || refreshing || document.hidden || !hasPending || refreshes >= 6) return;
            clearTimeout(timer);
            refreshing = true;
            refreshes++;
            try {
                const { data, error: failure } = await supabase.functions.invoke(emailFunctionName, { body: { action: "status" } });
                if (failure || !Array.isArray(data?.batches)) throw new Error("Status unavailable");
                if (cancelled) return;
                setHistory(data.batches);
                setHistoryError("");
                hasPending = data.batches.some((batch) =>
                    (batch.admin_email_jobs ?? []).some((job) => ["pending", "processing"].includes(job.status))
                );
            } catch {
                hasPending = false;
                if (!cancelled) setHistoryError("Could not refresh email activity. Queued messages will continue processing. Use Refresh activity to try again.");
            } finally {
                refreshing = false;
                // Bound polling even when jobs remain queued overnight.
                if (!cancelled && !document.hidden && hasPending && refreshes < 6) {
                    timer = setTimeout(refresh, 60000);
                }
            }
        }

        function handleVisibilityChange() {
            clearTimeout(timer);

            if (!document.hidden && !refreshing && hasPending && refreshes < 6) {
            void refresh();
        }
    }

        document.addEventListener("visibilitychange", handleVisibilityChange);
        void refresh();
        return () => {
            cancelled = true;
            clearTimeout(timer);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [active, historyRevision, userId]);

    useEffect(() => {
        let cancelled = false;
        async function load() {
            if (!active) return;
            setLoading(true);
            setLoadError("");
            try {
                // Paginate so leagues larger than the database's default row limit
                // do not silently lose recipients or captain assignments.
                async function allRows(table, columns, order) {
                    const rows = [];
                    for (let offset = 0; ; offset += 500) {
                        const { data, error: failure } = await supabase.from(table)
                            .select(columns).order(order).range(offset, offset + 499);
                        if (failure) throw failure;
                        rows.push(...data);
                        if (data.length < 500) return rows;
                    }
                }
                const [members, captains, teamRows, rosterRows] = await Promise.all([
                    allRows("profiles", "id, full_name, email", "id"),
                    allRows("team_captains", "profile_id, team_id", "profile_id"),
                    allRows("teams", "id, name", "id"),
                    allRows("team_members", "id, profile_id, team_id", "id"),
                ]);
                if (cancelled) return;
                setProfiles(members.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")));
                setCaptainIds(new Set(captains.map((captain) => captain.profile_id)));
                setTeams(teamRows);
                setMemberships(rosterRows);
                setSelectedIds((previous) => new Set(members.filter((p) => previous.has(p.id) && hasEmail(p)).map((p) => p.id)));
            } catch {
                if (!cancelled) setLoadError("Could not load members and team captains. Please try again.");
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        load();
        return () => { cancelled = true; };
    }, [active, revision]);

    const selected = profiles.filter((p) => selectedIds.has(p.id));
    const groupedRecipients = groupEmailRecipients(profiles, teams, memberships, { search, captainsOnly, captainIds });
    const visible = [...new Map(groupedRecipients.flatMap((team) => team.members).map((profile) => [profile.id, profile])).values()];
    const emailCount = new Set(selected.map((p) => p.email.trim().toLowerCase())).size;

    function toggle(id) {
        setNotice("");
        setSelectedIds((previous) => {
            const next = new Set(previous);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    }

    async function send(event) {
        event.preventDefault();
        if (submitting.current || cooldown || loading || loadError) return;
        setError("");
        setNotice("");
        if (!selected.length || emailCount > 20 || !subject.trim() || !message.trim()) {
            setError("Select 1–20 email addresses and enter a subject and message.");
            return;
        }
        submitting.current = true;
        setSending(true);
        try {
            const payload = { recipients: selected.map((p) => p.email), subject, message };
            const requestId = await emailRequestId(sessionStorage, requestKey, payload);
            const result = await sendAdminEmail((name, options) => supabase.functions.invoke(name, options), emailFunctionName, { ...payload, requestId });
            try { sessionStorage.removeItem(requestKey); } catch { /* Retaining the ID is safe. */ }
            setCooldown(30);
            setHistoryRevision((value) => value + 1);
            setNotice(result.queued != null ? `${result.queued} emails queued. Follow their progress in Recent email activity.` : `${result.sent} email requests accepted for sending.`);
            setSelectedIds(new Set());
            setSubject("");
            setMessage("");
        } catch (failure) {
            if (failure.retryAfter) setCooldown(Math.ceil(failure.retryAfter));
            if (failure.acceptedRecipients?.length) {
                const accepted = new Set(failure.acceptedRecipients);
                setSelectedIds(new Set(selected.filter((p) => !accepted.has(p.email.trim().toLowerCase())).map((p) => p.id)));
            }
            setError(failure.message || "Could not confirm sending. Check email activity before retrying.");
        } finally {
            submitting.current = false;
            setSending(false);
        }
    }

    return <div className="page-view admin-email-view">
        <header className="page-header">
            <h2>Email Members</h2>
            <p className="page-subtitle">Send a message to team captains or choose individual league members.</p>
        </header>
        {loadError && <p className="form-error" role="alert">{loadError} <button type="button" className="action-btn action-btn--outline" onClick={() => setRevision((n) => n + 1)}>Retry</button></p>}
        <form onSubmit={send} className="admin-email-layout">
            <section className="content-card admin-email-card" aria-labelledby="email-recipients-heading">
                <h3 id="email-recipients-heading">Recipients</h3>
                <fieldset className="admin-email-panel" aria-labelledby="email-recipients-heading" disabled={loading || sending || Boolean(loadError)}>
                {loading && <p role="status">Loading members...</p>}
                <label className="form-field"><span>Search members</span><input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, email, or team" /></label>
                <label className="admin-email-person"><input type="checkbox" checked={captainsOnly} onChange={(e) => setCaptainsOnly(e.target.checked)} /> Show team captains only</label>
                <div className="admin-email-actions">
                    <button type="button" className="action-btn action-btn--outline" onClick={() => {
                        setNotice("");
                        setSelectedIds(new Set(profiles.filter((p) => captainIds.has(p.id) && hasEmail(p)).map((p) => p.id)));
                    }}>Select all captains</button>
                    <button type="button" className="action-btn action-btn--outline" onClick={() => setSelectedIds((previous) => new Set([...previous, ...visible.filter(hasEmail).map((p) => p.id)]))}>Add visible members</button>
                    <button type="button" className="action-btn action-btn--outline" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
                </div>
                <p aria-live="polite">{selected.length} members selected ({emailCount} email addresses; maximum 20 per send)</p>
                {emailCount > 20 && <p className="form-error" role="alert">Remove recipients until no more than 20 email addresses are selected.</p>}
                <div className="admin-email-recipients">
                    {groupedRecipients.map((team) => <section className="admin-email-team" key={team.id} aria-label={team.name}>
                        <header className="admin-email-team-heading">
                            <h3>{team.name}</h3>
                            <span>{team.members.filter((p) => selectedIds.has(p.id)).length} / {team.members.length} selected</span>
                        </header>
                        {!team.members.length && <p className="empty-state">No players assigned to this team.</p>}
                        {team.members.map((p) => <label className="admin-email-person" key={p.id}>
                            <input type="checkbox" checked={selectedIds.has(p.id)} disabled={!hasEmail(p)} onChange={() => toggle(p.id)} />
                            <span><strong>{p.full_name || "Unnamed member"}{captainIds.has(p.id) ? " · Captain" : ""}</strong><small>{p.email || "No email address"}{!hasEmail(p) && p.email ? " · Invalid email" : ""}</small></span>
                        </label>)}
                    </section>)}
                    {!loading && !loadError && !groupedRecipients.length && <p className="empty-state">No matching members.</p>}
                </div>
                </fieldset>
            </section>
            <section className="content-card admin-email-card" aria-labelledby="email-message-heading">
                <h3 id="email-message-heading">Message</h3>
                <fieldset className="admin-email-panel" aria-labelledby="email-message-heading" disabled={sending}>
                <label className="form-field"><span>Subject</span><input required maxLength={200} value={subject} onChange={(e) => setSubject(e.target.value)} /></label>
                <label className="form-field"><span>Message</span><textarea required rows={10} maxLength={10000} value={message} onChange={(e) => setMessage(e.target.value)} /></label>
                {selected.length > 0 && <details><summary>Review selected recipients ({selected.length})</summary><ul className="admin-email-review">{selected.map((p) => <li key={p.id}>{p.full_name} ({p.email}) <button type="button" className="action-btn action-btn--outline" aria-label={`Remove ${p.full_name || p.email}`} onClick={() => toggle(p.id)}>Remove</button></li>)}</ul></details>}
                {cooldown > 0 && <p role="status">You can submit another message in {cooldown} seconds.</p>}
                {error && <p className="form-error" role="alert">{error}</p>}
                {notice && <p role="status">{notice}</p>}
                <button type="submit" className="action-btn action-btn--primary" disabled={sending || cooldown > 0 || loading || Boolean(loadError) || emailCount > 20 || !selected.length || !subject.trim() || !message.trim()}>{sending ? "Sending..." : `Send email to ${emailCount} ${emailCount === 1 ? "address" : "addresses"}`}</button>
                </fieldset>
            </section>
        </form>
        <section className="content-card admin-email-history">
            <h3>Recent email activity</h3>
            <button type="button" className="action-btn action-btn--outline" onClick={() => setHistoryRevision((value) => value + 1)}>Refresh activity</button>
            <p>Activity refreshes once a minute for up to five minutes while messages are queued. Use Refresh activity to check again later.</p>
            <p>Messages are queued and sent one at a time. Accepted means the email provider accepted the request; it does not confirm inbox delivery.</p>
            {historyError && <p role="status">{historyError}</p>}
            {!history.length && !historyError && <p>No recent email submissions.</p>}
            {history.map((batch) => {
                const jobs = batch.admin_email_jobs ?? [];
                const accepted = jobs.filter((job) => job.status === "sent").length;
                const pending = jobs.filter((job) => ["pending", "processing"].includes(job.status)).length;
                const failed = jobs.filter((job) => ["failed", "needs_review"].includes(job.status));
                return <details key={batch.id}>
                    <summary>{batch.subject} — {accepted} accepted, {pending} queued, {failed.length} need attention</summary>
                    <p>{new Date(batch.created_at).toLocaleString()}</p>
                    <ul>{jobs.map((job) => <li key={job.recipient}>{job.recipient}: {job.status === "sent" ? "Accepted" : job.status === "needs_review" ? "Needs review" : job.status}{job.last_error && job.status !== "sent" ? ` — ${job.last_error}` : ""}</li>)}</ul>
                </details>;
            })}
        </section>
    </div>;
}
