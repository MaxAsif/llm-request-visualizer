export const LoadingState = ({ label = "Loading" }: { label?: string }) => (
  <p className="state state--loading">{label}…</p>
)

export const ErrorState = ({ message }: { message: string }) => (
  <p className="state state--error">Request failed — {message}</p>
)

export const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
  <div className="state state--empty">
    <div className="state__title">{title}</div>
    <div>{hint}</div>
  </div>
)
