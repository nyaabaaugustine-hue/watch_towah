"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { isWatchtowerError } from "@/lib/errors";
import { DEFAULT_GRACE_MINUTES, MAX_GRACE_MINUTES, MIN_GRACE_MINUTES } from "@/lib/journey";
import { requireUserId } from "@/server/session";
import {
  cancelJourney,
  createJourney,
  markJourneyArrived,
  startJourney,
} from "@/server/journeys";

export type JourneyActionState = { ok: true; message: string } | { ok: false; message: string };

/**
 * The destination is a label, not coordinates, because on a metered connection
 * asking a person to geocode a destination before they can start monitoring
 * themselves is a good way to have them not use the feature. Coordinates are
 * accepted when the map already knows them, and the label is what is shown.
 */
const createSchema = z.object({
  destinationLabel: z
    .string()
    .trim()
    .min(2, "Say where you are going.")
    .max(160, "That destination name is too long."),
  startLabel: z
    .string()
    .trim()
    .max(160, "That starting point name is too long.")
    .optional()
    .or(z.literal("")),
  expectedArrival: z.string().min(1, "Choose when you expect to arrive."),
  graceMinutes: z.coerce
    .number()
    .int("Grace must be a whole number of minutes.")
    .min(MIN_GRACE_MINUTES, `Give your circle at least ${MIN_GRACE_MINUTES} minutes of grace.`)
    .max(MAX_GRACE_MINUTES, `Grace cannot be more than ${MAX_GRACE_MINUTES} minutes.`)
    .default(DEFAULT_GRACE_MINUTES),
});

const toActionError = (error: unknown): JourneyActionState => {
  if (isWatchtowerError(error)) {
    return { ok: false, message: error.message };
  }
  // A bare Error from the data layer is an unexpected state, not user error, so
  // the message is deliberately generic: the detail belongs in the log, not on a
  // phone screen held by somebody who is already worried.
  console.error("[journey] action failed", error);
  return { ok: false, message: "Something went wrong. Please try again." };
};

/**
 * Plan a journey.
 *
 * The expected arrival is interpreted in the phone's own timezone and sent as an
 * absolute ISO instant. Sending "17:30" would be ambiguous the moment somebody
 * crosses a region boundary with a different offset from the server.
 */
export const createJourneyAction = async (_prevState: JourneyActionState, formData: FormData): Promise<JourneyActionState> => {
  const userId = await requireUserId();

  const parsed = createSchema.safeParse({
    destinationLabel: formData.get("destinationLabel"),
    startLabel: formData.get("startLabel") ?? "",
    expectedArrival: formData.get("expectedArrival"),
    graceMinutes: formData.get("graceMinutes") ?? DEFAULT_GRACE_MINUTES,
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "Check the details and try again." };
  }

  const expectedArrival = new Date(parsed.data.expectedArrival);
  if (Number.isNaN(expectedArrival.getTime())) {
    return { ok: false, message: "That arrival time could not be read." };
  }
  if (expectedArrival.getTime() <= Date.now()) {
    return { ok: false, message: "Choose an arrival time in the future." };
  }

  // The schema allows the optional field to arrive as undefined, "", or a
  // padded string; normalising here keeps the null-vs-empty distinction out of
  // every reader downstream.
  const startLabel = (parsed.data.startLabel ?? "").trim();
  const destinationLabel = parsed.data.destinationLabel.trim();

  try {
    await createJourney(db, {
      userId,
      destinationLabel,
      startLabel: startLabel === "" ? null : startLabel,
      expectedArrival,
      graceMinutes: parsed.data.graceMinutes,
      startLat: null,
      startLng: null,
      destinationLat: null,
      destinationLng: null,
    });
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/journey");
  revalidatePath("/");
  return { ok: true, message: `Watching your trip to ${destinationLabel}.` };
};

/** Move a planned journey to active. */
export const startJourneyAction = async (_prevState: JourneyActionState, formData: FormData): Promise<JourneyActionState> => {
  const userId = await requireUserId();
  const journeyId = formData.get("journeyId");

  if (typeof journeyId !== "string" || journeyId === "") {
    return { ok: false, message: "That journey could not be found." };
  }

  try {
    await startJourney(db, userId, journeyId);
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/journey");
  revalidatePath("/");
  return { ok: true, message: "Journey started. Your circle can follow it now." };
};

/**
 * Record arrival.
 *
 * This is the action that stops an escalation. It is deliberately a separate
 * button from cancelling: arriving is a claim about safety, cancelling is a
 * change of plan, and conflating them would let a person silence a genuine
 * "she never arrived" alert by tapping the wrong one.
 */
export const arriveJourneyAction = async (_prevState: JourneyActionState, formData: FormData): Promise<JourneyActionState> => {
  const userId = await requireUserId();
  const journeyId = formData.get("journeyId");

  if (typeof journeyId !== "string" || journeyId === "") {
    return { ok: false, message: "That journey could not be found." };
  }

  try {
    await markJourneyArrived(db, userId, journeyId);
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/journey");
  revalidatePath("/");
  return { ok: true, message: "Arrival recorded. Your circle has stopped watching." };
};

/** Cancel a journey so it never escalates. */
export const cancelJourneyAction = async (_prevState: JourneyActionState, formData: FormData): Promise<JourneyActionState> => {
  const userId = await requireUserId();
  const journeyId = formData.get("journeyId");

  if (typeof journeyId !== "string" || journeyId === "") {
    return { ok: false, message: "That journey could not be found." };
  }

  try {
    await cancelJourney(db, userId, journeyId);
  } catch (error) {
    return toActionError(error);
  }

  revalidatePath("/journey");
  revalidatePath("/");
  return { ok: true, message: "Journey cancelled. No alerts will be sent." };
};
