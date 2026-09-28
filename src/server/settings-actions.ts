"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { isWatchtowerError } from "@/lib/errors";
import {
  MAX_ACTIVE_INTERVAL_SECONDS,
  MAX_BACKGROUND_INTERVAL_SECONDS,
  MAX_RETENTION_DAYS,
  MIN_ACTIVE_INTERVAL_SECONDS,
  MIN_BACKGROUND_INTERVAL_SECONDS,
  MIN_RETENTION_DAYS,
} from "@/lib/settings";
import { requireUserId } from "@/server/session";
import { updateUserSettings } from "@/server/users";

export type SettingsActionState = { ok: true; message: string } | { ok: false; message: string };

/**
 * Every number is parsed with `z.coerce`, because a `<select>` and a number
 * input both hand back strings while the column is an integer. Clamping is
 * enforced here rather than trusted from the client: the bounds exist to stop
 * somebody saving a 1-second background interval and quietly draining a
 * metered data plan overnight.
 */
const settingsSchema = z.object({
  lowDataMode: z.boolean(),
  batterySaver: z.boolean(),
  backgroundIntervalSeconds: z.coerce
    .number()
    .int()
    .min(MIN_BACKGROUND_INTERVAL_SECONDS, `That is faster than ${MIN_BACKGROUND_INTERVAL_SECONDS} seconds.`)
    .max(MAX_BACKGROUND_INTERVAL_SECONDS, `That is slower than ${MAX_BACKGROUND_INTERVAL_SECONDS} seconds.`),
  activeIntervalSeconds: z.coerce
    .number()
    .int()
    .min(MIN_ACTIVE_INTERVAL_SECONDS, `Live updates cannot be faster than ${MIN_ACTIVE_INTERVAL_SECONDS} seconds.`)
    .max(MAX_ACTIVE_INTERVAL_SECONDS, `Live updates cannot be slower than ${MAX_ACTIVE_INTERVAL_SECONDS} seconds.`),
  smsFallbackEnabled: z.boolean(),
  smsOnly: z.boolean(),
  shareLocationByDefault: z.boolean(),
  locationRetentionDays: z.coerce
    .number()
    .int()
    .min(MIN_RETENTION_DAYS, "Keep at least one day of history.")
    .max(MAX_RETENTION_DAYS, "Keep at most a year of history."),
});

/** A checkbox is absent from `FormData` entirely when unticked. */
const checked = (formData: FormData, name: string): boolean => formData.get(name) === "on";

const numberFrom = (formData: FormData, name: string): number => Number(text(formData, name));

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export const updateSettingsAction = async (
  _prevState: SettingsActionState,
  formData: FormData,
): Promise<SettingsActionState> => {
  const userId = await requireUserId();

  const parsed = settingsSchema.safeParse({
    lowDataMode: checked(formData, "lowDataMode"),
    batterySaver: checked(formData, "batterySaver"),
    backgroundIntervalSeconds: numberFrom(formData, "backgroundIntervalSeconds"),
    activeIntervalSeconds: numberFrom(formData, "activeIntervalSeconds"),
    smsFallbackEnabled: checked(formData, "smsFallbackEnabled"),
    smsOnly: checked(formData, "smsOnly"),
    shareLocationByDefault: checked(formData, "shareLocationByDefault"),
    locationRetentionDays: numberFrom(formData, "locationRetentionDays"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? "Check the settings and try again.",
    };
  }

  // `smsOnly` removes push and email from the fan-out, so leaving both on at
  // once is a contradiction rather than a preference. Resolving it here keeps
  // the pair coherent no matter which order the two boxes were ticked in.
  const smsOnly = parsed.data.smsOnly;
  const smsFallbackEnabled = smsOnly ? false : parsed.data.smsFallbackEnabled;

  try {
    await updateUserSettings(db, userId, { ...parsed.data, smsFallbackEnabled });
  } catch (error) {
    if (isWatchtowerError(error)) {
      return { ok: false, message: error.message };
    }
    console.error("[settings] update failed", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }

  // The dashboard reads these settings to label what sharing is doing, so the
  // cached dashboard has to be rebuilt alongside this page.
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/share");
  return { ok: true, message: "Settings saved." };
};
