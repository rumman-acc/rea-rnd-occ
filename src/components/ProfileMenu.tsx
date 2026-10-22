"use client";

import { LogOut } from "lucide-react";
import { useState } from "react";
import { useSession } from "@/state/Session";

// Initials: up to two, from the name (or email) split on whitespace / "@" / "." (SPEC FR-006).
export function initialsOf(nameOrEmail: string): string {
  return nameOrEmail
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join("");
}

/** Profile button for the signed-in user. Not rendered without a session email (SPEC FR-006). */
export function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const { user, signOut } = useSession();
  if (!user?.email) return null;
  const initials = initialsOf(user.name || user.email);

  return (
    <div className="profile">
      <button type="button" className="profile__button" aria-label="Profile" onClick={() => setOpen(!open)}>
        {initials}
      </button>
      {open && (
        <>
          <div className="profile__backdrop" onClick={() => setOpen(false)} />
          <div className="profile__menu">
            <div className="profile__who">
              <div className="profile__avatar">{initials}</div>
              <div className="profile__id">
                <div className="profile__name">{user.name}</div>
                <div className="profile__email" title={user.email}>
                  {user.email}
                </div>
              </div>
            </div>
            <div className="profile__role">
              <div className="profile__rolelabel">Role</div>
              <div className="profile__rolebadge">{user.role || "User"}</div>
            </div>
            <button type="button" className="profile__signout" onClick={() => void signOut()}>
              <LogOut size={14} aria-hidden="true" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
