"use client";

import { useActionState, useRef, useState } from "react";
import { Eye, Phone, ShieldCheck, Trash2, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import {
  permissionLevelDetails,
  permissionLevels,
  seesRoutineLocation,
  type PermissionLevel,
} from "@/lib/circle";
import { removeCircleContactAction, updateCircleContactAction } from "@/server/circle-actions";
import type { CircleActionState } from "@/server/circle-actions";

const initialState: CircleActionState = { ok: false, message: "" };

const selectClass =
  "min-h-11 w-full rounded-card bg-ink-canvas px-3 text-body text-ink ring-1 ring-inset ring-ink/10";

type CircleContactCardProps = {
  id: string;
  name: string;
  phone: string;
  relationship: string | null;
  permissionLevel: PermissionLevel;
  canViewGuardianCircle: boolean;
  /**
   * True when this contact has their own Watchtower account. Only then can they
   * be shown as a viewer; the rest are reachable by SMS alone.
   */
  isSignedUp: boolean;
};

const CircleContactCard = ({
  id,
  name,
  phone,
  relationship,
  permissionLevel,
  canViewGuardianCircle,
  isSignedUp,
}: CircleContactCardProps) => {
  const [updateState, updateAction, updatePending] = useActionState<CircleActionState, FormData>(
    updateCircleContactAction,
    initialState,
  );
  const [removeState, removeAction, removePending] = useActionState<CircleActionState, FormData>(
    removeCircleContactAction,
    initialState,
  );
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const permissionFormRef = useRef<HTMLFormElement>(null);
  const viewerFormRef = useRef<HTMLFormElement>(null);

  const routine = seesRoutineLocation(permissionLevel);

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-pill",
              routine ? "bg-safe-50 text-safe-700" : "bg-ink-canvas text-ink-muted",
            )}
            aria-hidden
          >
            {routine ? <ShieldCheck className="size-4" /> : <UserRound className="size-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display text-section text-ink">{name}</p>
            <p className="mt-0.5 truncate text-sm text-ink-muted">
              {relationship ?? "Guardian"} · {phone}
            </p>
          </div>
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 text-sm">
        <div className="flex items-start gap-2">
          <Phone className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
          <div className="min-w-0">
            <dt className="sr-only">Phone number</dt>
            <dd className="text-ink-muted">{phone}</dd>
            <dd className="text-xs text-ink-faint">
              {permissionLevel === "emergency_only"
                ? "Only contacted if you raise an SOS."
                : routine
                  ? "Follows your location while sharing is on."
                  : "Contacted if you raise an SOS."}
            </dd>
          </div>
        </div>
      </dl>

      {/*
        Keyed on the persisted value. React resets uncontrolled fields to their
        mount-time `defaultValue` after a server action submits, so without a
        remount the select would visibly snap back to the value it had *before*
        the save — right after the action reported success. Re-keying on the
        value the server just sent re-reads the correct default.
      */}
      <form
        key={`permission-${permissionLevel}`}
        ref={permissionFormRef}
        action={updateAction}
        className="mt-4"
      >
        <input type="hidden" name="contactId" value={id} />
        <input type="hidden" name="intent" value="permission" />
        <label className="mb-1.5 block text-sm font-bold text-ink" htmlFor={`permission-${id}`}>
          What they can see
        </label>
        <select
          id={`permission-${id}`}
          name="permissionLevel"
          defaultValue={permissionLevel}
          disabled={updatePending}
          onChange={() => {
            // Selecting an option is the whole interaction here, so submitting on
            // change keeps it to a single tap. Left as an explicit Save button it
            // would read as a form to fill in, which is more friction than this
            // decision deserves.
            permissionFormRef.current?.requestSubmit();
          }}
          className={selectClass}
        >
          {permissionLevels.map((level) => (
            <option key={level} value={level}>
              {permissionLevelDetails[level].label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-ink-faint">{permissionLevelDetails[permissionLevel].description}</p>
      </form>

      <form
        key={`viewer-${canViewGuardianCircle ? "yes" : "no"}`}
        ref={viewerFormRef}
        action={updateAction}
        className="mt-3"
      >
        <input type="hidden" name="contactId" value={id} />
        <input type="hidden" name="intent" value="viewer" />
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            name="canViewGuardianCircle"
            defaultChecked={canViewGuardianCircle}
            disabled={updatePending}
            onChange={() => {
              viewerFormRef.current?.requestSubmit();
            }}
            className="mt-0.5 size-4 shrink-0 accent-watchtower-600"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
              <Eye className="size-3.5" aria-hidden />
              Can see my Guardian Circle
            </span>
            <span className="mt-0.5 block text-xs text-ink-muted">
              {isSignedUp
                ? "Records that they are allowed to see who else is in your circle."
                : "They have no Watchtower account yet, so there is nobody to show it to. Turning this on now means it applies the moment they sign up with this number."}
            </span>
          </span>
        </label>
      </form>

      {updateState.message !== "" ? (
        <p role="status" className="mt-2 text-sm font-bold text-safe-700">
          {updateState.message}
        </p>
      ) : null}

      <form action={removeAction} className="mt-4 border-t border-ink/10 pt-3">
        <input type="hidden" name="contactId" value={id} />
        {confirmingRemove ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-bold text-sos-700">
              Remove {name}? They will no longer be told about your SOS.
            </p>
            <div className="flex gap-2">
              <Button type="submit" variant="sos" size="md" disabled={removePending}>
                {removePending ? "Removing…" : "Yes, remove"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="md"
                onClick={() => {
                  setConfirmingRemove(false);
                }}
              >
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="md"
            fullWidth
            onClick={() => {
              setConfirmingRemove(true);
            }}
          >
            <Trash2 className="size-4" aria-hidden />
            Remove from my circle
          </Button>
        )}
        {removeState.message !== "" ? (
          <p role="status" className="mt-2 text-sm font-bold text-ink-muted">
            {removeState.message}
          </p>
        ) : null}
      </form>
    </Card>
  );
};

export { CircleContactCard };
