import Link from "next/link";
import {
  addWater,
  endRecovery,
  logSelfCare,
  logSkip,
  logWeighIn,
  takeStack,
  undoEvent,
} from "@/app/actions/today";
import { fmt, hitPoints, questView, shortExercise, summarizeSets } from "@/lib/dashboard";
import { KG_PER_LB, ML_PER_OZ } from "@/lib/targets";
import type { Today } from "@/lib/today";
import styles from "./Dashboard.module.css";
import { SubmitButton } from "./SubmitButton";

const time = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(new Date(iso));

function Undo({ eventId, label }: { eventId: number; label: string }) {
  return (
    <form action={undoEvent}>
      <input type="hidden" name="event_id" value={eventId} />
      <SubmitButton className={styles.pillButton} aria-label={label}>
        Undo
      </SubmitButton>
    </form>
  );
}

function Check() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FBF8F2" strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ---- Hit points: calories and macros ------------------------------------------
export function HitPoints({
  totals,
  targets,
  stackFiber,
}: {
  totals: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
  targets: NonNullable<Today["targets"]>;
  stackFiber: number; // fiber from the daily stack taken today
}) {
  const hp = hitPoints(totals.kcal, targets.calorie_target, targets.calorie_window_pct);
  const macros = [
    { name: "Protein", value: totals.protein, target: targets.protein_g, color: "var(--red)" },
    {
      name: targets.carbs_are_ceiling ? "Carbs (ceiling)" : "Carbs",
      value: totals.carbs,
      target: targets.carbs_g,
      color: "var(--teal)",
    },
    { name: "Fat", value: totals.fat, target: targets.fat_g, color: "#9A6B12" },
    {
      name: "Fiber",
      value: totals.fiber + stackFiber,
      target: targets.fiber_g,
      color: "var(--green)",
      note:
        stackFiber > 0
          ? `${fmt(totals.fiber)} g from food + ${fmt(stackFiber)} g from supplements`
          : undefined,
    },
  ];
  return (
    <section className={styles.card} aria-labelledby="hp-heading">
      <div className={styles.head}>
        <h2 id="hp-heading" className={styles.title}>
          Hit points
        </h2>
        <span className={styles.sub}>Calories today</span>
      </div>
      <div className={styles.big}>
        <span className={styles.bigValue}>{fmt(totals.kcal)}</span>
        <span className={styles.bigUnit}>/ {fmt(targets.calorie_target)} kcal</span>
      </div>
      <div>
        <div
          className={styles.hpBar}
          role="meter"
          aria-label="Calories today"
          aria-valuenow={Math.round(totals.kcal)}
          aria-valuemin={0}
          aria-valuemax={Math.round(hp.high * 1.1)}
          aria-valuetext={`${fmt(totals.kcal)} kcal. ${hp.message}`}
        >
          <div className={styles.hpWindow} style={{ left: `${hp.windowFromPct}%`, width: `${hp.windowWidthPct}%` }} />
          <div className={hp.state === "over" ? styles.hpFillOver : styles.hpFill} style={{ width: `${hp.fillPct}%` }} />
        </div>
        <div className={styles.hpLegend} style={{ marginTop: 6 }}>
          <span>{hp.message}</span>
          <span className={styles.hpWindowLabel}>
            Window {fmt(hp.low)}–{fmt(hp.high)}
          </span>
        </div>
      </div>
      <div className={styles.macros}>
        {macros.map((m) => (
          <div key={m.name} className={styles.macro}>
            <div className={styles.macroTop}>
              <span className={styles.macroName}>{m.name}</span>
              <span className={styles.sub}>
                {fmt(m.value)} / {fmt(m.target)} g
              </span>
            </div>
            {"note" in m && m.note && <span className={styles.sub}>{m.note}</span>}
            <div className={styles.bar} role="presentation">
              <div
                className={styles.barFill}
                style={{ width: `${m.target > 0 ? Math.min(100, (m.value / m.target) * 100) : 0}%`, background: m.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Quests and the weekly bosses -----------------------------------------------
const BOSS_TEXT: Record<string, (p: number, t: number) => string> = {
  boss_fully_logged: (p, t) => `Fully log ${t} of 7 days · ${fmt(p)} of ${t} so far`,
  boss_all_sessions: (p, t) => `Complete every planned session · ${fmt(p)} of ${fmt(t)} so far`,
};

export function Quests({ today }: { today: Today }) {
  const { quests, bosses, timezone, waterUnit, targets } = today;
  const daysLeft = 7 - Math.round((Date.parse(today.date) - Date.parse(today.monday)) / 86_400_000) - 1;
  const opts = { waterUnit, timeZone: timezone, windowPct: targets?.calorie_window_pct ?? 10 };
  return (
    <section className={styles.card} aria-labelledby="quests-heading">
      <div>
        <h2 id="quests-heading" className={styles.title}>
          Today&apos;s quests
        </h2>
        <p className={styles.note}>They complete on their own when the goal is actually hit.</p>
      </div>
      {quests.length === 0 ? (
        <p className={styles.note}>Quests appear here once today has been scored. Log something to start.</p>
      ) : (
        <ul className={styles.quests}>
          {quests.map((q) => {
            const v = questView(q, opts);
            return (
              <li key={q.code} className={styles.quest}>
                <span className={v.done ? styles.questDone : styles.questBox} aria-hidden="true">
                  {v.done ? <Check /> : v.badge}
                </span>
                <span className={styles.questText}>
                  <span className={styles.questName}>
                    {q.name}
                    <span className="visually-hidden">{v.done ? " (done)" : " (open)"}</span>
                  </span>
                  <span className={styles.questDetail}>{v.detail}</span>
                </span>
                {v.xp && <span className={styles.xp}>{v.xp}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {bosses.map((b) => (
        <div key={b.code} className={styles.boss}>
          <div className={styles.bossLabel}>
            <strong>Weekly boss</strong>
            <span>
              {b.completedAt
                ? `Defeated · +${b.xp} XP`
                : daysLeft === 0
                  ? "Last day"
                  : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            </span>
          </div>
          <span className={styles.bossName}>{b.name.replace(/^Weekly boss: /, "")}</span>
          <span className={styles.bossText}>
            {(BOSS_TEXT[b.code] ?? ((p: number, t: number) => `${fmt(p)} of ${fmt(t)}`))(b.progress, b.target)}
          </span>
          <div className={styles.bossBar} role="presentation">
            <div
              className={styles.bossFill}
              style={{ width: `${b.target > 0 ? Math.min(100, (b.progress / b.target) * 100) : 0}%` }}
            />
          </div>
        </div>
      ))}
    </section>
  );
}

// ---- Daily stack --------------------------------------------------------------
export function Stack({ today }: { today: Today }) {
  const { items, taken } = today.stack;
  return (
    <section className={styles.card} aria-labelledby="stack-heading">
      <div className={styles.head}>
        <h2 id="stack-heading" className={styles.plainTitle}>
          Daily stack
        </h2>
        <span className={styles.xp}>+1 Alchemist XP</span>
      </div>
      {items.length === 0 ? (
        <p className={styles.note}>
          No supplements yet. <Link href="/settings#stack-heading">Add your stack in Settings</Link>.
        </p>
      ) : (
        <>
          <div style={{ fontSize: 14 }}>{items.map((i) => i.name).join(" · ")}</div>
          <div className={styles.between}>
            {taken ? (
              <>
                <span className={styles.good}>Taken at {time(taken.at, today.timezone)}</span>
                <Undo eventId={taken.eventId} label="Undo taking the stack" />
              </>
            ) : (
              <form action={takeStack}>
                <SubmitButton className={styles.primaryButton} pendingText="Saving…">
                  Take stack
                </SubmitButton>
              </form>
            )}
          </div>
        </>
      )}
      <p className={styles.note}>Counts in nutrient totals, never in INT.</p>
    </section>
  );
}

// ---- Water ------------------------------------------------------------------
export function Water({ today }: { today: Today }) {
  const oz = today.waterUnit === "oz";
  const show = (ml: number) => (oz ? fmt(ml / ML_PER_OZ) : fmt(ml));
  const unit = oz ? "oz" : "mL";
  const goal = today.targets?.water_goal_ml ?? 0;
  const amounts = oz ? [8, 16, 32] : [250, 500, 1000];
  return (
    <section className={styles.card} aria-labelledby="water-heading">
      <div className={styles.head}>
        <h2 id="water-heading" className={styles.plainTitle}>
          Water
        </h2>
        <span className={styles.xp}>+1 Alchemist XP at goal</span>
      </div>
      <div className={styles.between}>
        <div className={styles.big}>
          <span className={styles.bigValue} style={{ fontSize: 28 }}>
            {show(today.water.totalMl)}
          </span>
          <span className={styles.bigUnit}>{goal > 0 ? `/ ${show(goal)} ${unit}` : unit}</span>
        </div>
        {today.water.lastEventId && <Undo eventId={today.water.lastEventId} label="Undo the last water" />}
      </div>
      {goal > 0 && (
        <div className={styles.bar} style={{ height: 10 }} role="presentation">
          <div
            className={styles.barFill}
            style={{ width: `${Math.min(100, (today.water.totalMl / goal) * 100)}%`, background: "var(--teal)" }}
          />
        </div>
      )}
      <div className={styles.row3}>
        {amounts.map((a) => (
          <form key={a} action={addWater}>
            <input type="hidden" name="amount" value={a} />
            <input type="hidden" name="unit" value={today.waterUnit} />
            <SubmitButton className={styles.waterButton}>
              +{a} {unit}
            </SubmitButton>
          </form>
        ))}
      </div>
      <p className={styles.note}>XP only; water doesn&apos;t change any ability score.</p>
    </section>
  );
}

// ---- Training -----------------------------------------------------------------
const SKIP_LABEL = { injury: "Injury", sick: "Sick", skipped: "Skipped" } as const;

export function Training({ today }: { today: Today }) {
  const { sessions, skip, recovery, isRestDay } = today.training;
  const unit = today.weightUnit;
  return (
    <section className={styles.card} aria-labelledby="training-heading">
      <div className={styles.head}>
        <h2 id="training-heading" className={styles.plainTitle}>
          Training
        </h2>
        <span className={styles.sub}>From Liftosaur</span>
      </div>
      {sessions.length === 0 && (
        <p className={styles.note}>
          {isRestDay
            ? "Rest day. Rest days are long rests."
            : "No session synced yet today. Liftosaur syncs every 2 hours."}
        </p>
      )}
      {sessions.map((s) => {
        const summary = summarizeSets(s.sets, unit);
        const prs = summary.filter((x) => x.pr);
        return (
          <div key={s.eventId} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className={styles.sub}>
              {[s.program, s.label].filter(Boolean).join(" · ")} · {time(s.at, today.timezone)}
            </div>
            <ul className={styles.sets}>
              {summary.map((x) => (
                <li key={x.exercise} className={styles.set}>
                  <span>
                    <strong>{shortExercise(x.exercise)}</strong>
                    {x.tier && ` · ${x.tier}`} · {x.text}
                  </span>
                  {x.pr && <span className={styles.pr}>PR</span>}
                </li>
              ))}
            </ul>
            {prs.length > 0 && (
              <div className={styles.callout}>
                {prs.map((x) => (
                  <strong key={x.exercise}>
                    New estimated 1RM: {shortExercise(x.exercise)} {x.best1rm} {unit}
                  </strong>
                ))}
                <span className={styles.sub}>+20 Barbarian per PR · counts toward STR</span>
              </div>
            )}
          </div>
        );
      })}

      {recovery && (
        <div className={styles.callout}>
          <strong>
            {recovery.reason === "injury" ? "Recovering from an injury" : "Recovering from being sick"} · STR is
            frozen
          </strong>
          <span className={styles.sub}>
            Since {new Date(recovery.startsOn + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric" })}.
            Missed sessions don&apos;t count against you until you&apos;re back.
          </span>
          <form action={endRecovery}>
            <input type="hidden" name="recovery_id" value={recovery.id} />
            <SubmitButton className={styles.linkish}>I&apos;m recovered</SubmitButton>
          </form>
        </div>
      )}

      {skip ? (
        <div className={styles.between}>
          <span className={styles.sub}>Today marked: {SKIP_LABEL[skip.reason]}</span>
          <Undo eventId={skip.eventId} label="Undo marking today" />
        </div>
      ) : (
        sessions.length === 0 &&
        !isRestDay && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className={styles.sub}>Can&apos;t train today?</span>
            <div className={styles.row3}>
              {(["injury", "sick", "skipped"] as const).map((r) => (
                <form key={r} action={logSkip}>
                  <input type="hidden" name="reason" value={r} />
                  <SubmitButton className={styles.plainButton}>{SKIP_LABEL[r]}</SubmitButton>
                </form>
              ))}
            </div>
            <p className={styles.note}>Injury and Sick freeze STR until you&apos;re recovered.</p>
          </div>
        )
      )}
    </section>
  );
}

// ---- Quick log: self-care (CHA) and weigh-in -----------------------------------
export function QuickLog({ today }: { today: Today }) {
  const unit = today.weightUnit;
  return (
    <section className={styles.card} aria-labelledby="quick-heading">
      <div className={styles.head}>
        <h2 id="quick-heading" className={styles.plainTitle}>
          Quick log
        </h2>
        <span className={styles.sub}>Feeds CHA</span>
      </div>
      <div className={styles.row2}>
        {today.selfCare.map((c) => {
          const logged = today.selfCareToday.filter((l) => l.categoryId === c.id).at(-1);
          return logged ? (
            <form key={c.id} action={undoEvent}>
              <input type="hidden" name="event_id" value={logged.eventId} />
              <SubmitButton className={styles.chaDone} aria-label={`${c.name}, logged. Tap to undo`}>
                {c.name}
                <span>Logged {time(logged.at, today.timezone)} · undo</span>
              </SubmitButton>
            </form>
          ) : (
            <form key={c.id} action={logSelfCare}>
              <input type="hidden" name="category_id" value={c.id} />
              <SubmitButton className={styles.chaButton}>
                {c.name}
                <span>CHA ×{c.weight}</span>
              </SubmitButton>
            </form>
          );
        })}
      </div>
      <details className={styles.weigh}>
        <summary>
          Weigh-in
          <span className={styles.sub}>
            {today.weighIn ? `Today: ${w(today.weighIn.kg, unit)} ${unit}` : "CHA · +5 Quartermaster XP"}
          </span>
        </summary>
        <form action={logWeighIn} className={styles.weighForm}>
          <label htmlFor="weigh-weight" className="visually-hidden">
            Weight in {unit}
          </label>
          <input id="weigh-weight" name="weight" inputMode="decimal" required placeholder={unit}
            className={styles.weighInput} />
          <input type="hidden" name="unit" value={unit} />
          <SubmitButton className={styles.primaryButton} pendingText="Saving…">
            Log weight
          </SubmitButton>
        </form>
        {today.weighIn && (
          <div className={styles.between} style={{ paddingBottom: 12 }}>
            <span className={styles.sub}>Logged a wrong number?</span>
            <Undo eventId={today.weighIn.eventId} label="Undo today's weigh-in" />
          </div>
        )}
      </details>
    </section>
  );
}

function w(kg: number, unit: "lb" | "kg") {
  return (Math.round((unit === "lb" ? kg / KG_PER_LB : kg) * 10) / 10).toLocaleString("en-US");
}
