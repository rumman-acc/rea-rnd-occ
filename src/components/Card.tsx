import type { ReactNode } from "react";

export function Card({
  title,
  actions,
  bodyClassName,
  children,
}: {
  title: string;
  actions?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <header className="card__header">
        <h2 className="card__title">{title}</h2>
        {actions}
      </header>
      <div className={bodyClassName ? `card__body ${bodyClassName}` : "card__body"}>{children}</div>
    </section>
  );
}
