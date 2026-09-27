import { env } from "@/lib/env";
import { UpstreamError } from "@/lib/errors";

/**
 * SMS gateway.
 *
 * Africa's Talking is the primary provider because it is the incumbent in
 * Ghana: direct MTN/Vodafone/AirtelTigo termination, local pricing, and it
 * actually delivers to feature phones over USSD-adjacent routes. Reachability
 * matters more than API elegance for an emergency channel.
 *
 * This module is the single boundary for outbound SMS. Everything above it
 * deals in `SmsResult` and never in provider response shapes.
 */
export type SmsResult = {
  providerMessageId: string;
  recipients: readonly string[];
};

type AfricaTalkingSendResponse = {
  status: number;
  message: string;
  num_messages?: number;
  recipients?: Array<{ recipient: string; status: number; message: string; messageId: string }>;
};

const SMS_SENDER_ID = "Watchtower";

/**
 * Send one SMS to a batch of recipients.
 *
 * @throws UpstreamError when the provider rejects the request or replies with
 *   a non-success status. Deliberately does not retry: an SMS that may already
 *   have been accepted must not be duplicated, because a Guardian Circle
 *   receiving three identical "I AM IN DANGER" texts loses trust in the alert
 *   they most need to act on. Retries are the caller's decision, using the
 *   `alert_deliveries` ledger to know what has already been attempted.
 */
export const sendSms = async (message: string, toNumbers: readonly string[]): Promise<SmsResult> => {
  if (toNumbers.length === 0) {
    throw new UpstreamError("africastalking", "Refusing to send an SMS to an empty recipient list.", {
      recipientCount: 0,
    });
  }

  const body = new URLSearchParams({
    username: env.AFRICAS_TALKING_USERNAME,
    to: toNumbers.join(","),
    message,
    from: SMS_SENDER_ID,
  });

  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      // Africa's Talking uses HTTP Basic for the account API key, with the
      // username repeated as the basic-auth user.
      Authorization: `Basic ${Buffer.from(`${env.AFRICAS_TALKING_USERNAME}:${env.AFRICAS_TALKING_API_KEY}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
    // Emergency traffic is worth waiting for; a hung request would leave a
    // Guardian Circle staring at nothing.
    signal: AbortSignal.timeout(10_000),
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new UpstreamError("africastalking", "SMS gateway returned an error status.", {
      httpStatus: response.status,
      body: responseText.slice(0, 500),
      recipientCount: toNumbers.length,
    });
  }

  let payload: AfricaTalkingSendResponse;
  try {
    payload = JSON.parse(responseText) as AfricaTalkingSendResponse;
  } catch (cause) {
    throw new UpstreamError("africastalking", "SMS gateway returned a non-JSON body.", {
      httpStatus: response.status,
      body: responseText.slice(0, 500),
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  if (payload.status !== 201) {
    throw new UpstreamError("africastalking", "SMS gateway rejected the request.", {
      gatewayStatus: payload.status,
      gatewayMessage: payload.message,
      recipientCount: toNumbers.length,
    });
  }

  // A 201 with a per-recipient failure still means *some* numbers were skipped.
  // Surface that rather than reporting blanket success — the caller records
  // it against the delivery ledger so a failed guardian can be retried by SMS
  // escalation instead of being assumed informed.
  const failed = (payload.recipients ?? []).filter((entry) => entry.status !== 0);
  if (failed.length > 0) {
    throw new UpstreamError("africastalking", "SMS gateway could not reach every recipient.", {
      gatewayMessage: payload.message,
      failedRecipients: failed.map((entry) => ({
        recipient: entry.recipient,
        status: entry.status,
        message: entry.message,
      })),
    });
  }

  return {
    providerMessageId: payload.recipients?.[0]?.messageId ?? payload.message,
    recipients: toNumbers,
  };
};
