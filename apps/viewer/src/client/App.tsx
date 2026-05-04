import { useState } from "react"
import { ExchangeDetailView } from "./views/ExchangeDetailView.js"
import { ExchangesView } from "./views/ExchangesView.js"
import { SessionDetailView, type SessionQuery } from "./views/SessionDetailView.js"
import { SessionsView } from "./views/SessionsView.js"

type View =
  | { readonly kind: "list" }
  | { readonly kind: "exchange"; readonly id: string }
  | { readonly kind: "session"; readonly query: SessionQuery }

export const App = () => {
  const [tab, setTab] = useState<"sessions" | "exchanges">("sessions")
  const [view, setView] = useState<View>({ kind: "list" })
  const back = () => setView({ kind: "list" })

  return (
    <main className="shell">
      <div className="topbar">
        <h1 className="topbar__brand">
          <span className="topbar__dot" aria-hidden="true" />
          LLM Visualizer
        </h1>
        <span className="topbar__tagline">local traffic inspector</span>
      </div>
      {view.kind === "exchange" ? <ExchangeDetailView id={view.id} onBack={back} /> : null}
      {view.kind === "session" ? <SessionDetailView query={view.query} onBack={back} /> : null}
      {view.kind === "list" ? (
        <>
          <nav className="tabs">
            {(["sessions", "exchanges"] as const).map((name) => (
              <button
                key={name}
                type="button"
                className={`tab${tab === name ? " is-active" : ""}`}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </nav>
          {tab === "sessions" ? (
            <SessionsView
              onSelect={(id) => setView({ kind: "exchange", id })}
              onOpenSession={(query) => setView({ kind: "session", query })}
            />
          ) : (
            <ExchangesView onSelect={(id) => setView({ kind: "exchange", id })} />
          )}
        </>
      ) : null}
    </main>
  )
}
