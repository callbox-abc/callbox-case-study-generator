// The number guard: every drafted sentence must be backed by the sheet's own data.

import { describe, expect, it } from "vitest";
import { allowedNumbers, guardText, type Drops } from "@/lib/narrative";
import { sheet } from "./fixtures";

const A = allowedNumbers(sheet());
const guard = (text: string) => {
  const dropped: Drops = { n: 0, items: [] };
  return { text: guardText(text, A, dropped), dropped };
};
const keeps = (text: string) => expect(guard(text).text).toBe(text);
const drops = (text: string, reason: string) => {
  const r = guard(text);
  expect(r.text).toBe("");
  expect(r.dropped.n).toBe(1);
  expect(r.dropped.items?.[0].reason).toBe(reason);
};

describe("plain numbers", () => {
  it("keeps numbers that are in the data", () => {
    keeps("LinkedIn produced 87 of the 111 appointments.");
    keeps("Email delivered 117,570 messages.");
  });

  it("keeps small counts (0 to 24) even when not in the data", () => {
    keeps("The program ran 4 channels.");
  });

  it("drops a number that is not in the data", () => {
    drops("LinkedIn produced 95 appointments.", "number not in the data");
  });

  it("drops only the bad sentence and keeps the rest", () => {
    const r = guard("LinkedIn produced 87 appointments. Email produced 95 more.");
    expect(r.text).toBe("LinkedIn produced 87 appointments.");
    expect(r.dropped.n).toBe(1);
  });

  it("does not split decimals into two sentences", () => {
    keeps("First meetings were held for 46.8% of appointments.");
  });
});

describe("percentages", () => {
  it("keeps a percentage the data already provides", () => {
    // insights.topChannel.sharePct = round(87 / 111 * 100) = 78
    keeps("LinkedIn drove 78% of tracked appointments.");
  });

  it("drops a derived percentage when its two source numbers are not in the sentence", () => {
    drops("Email drove 22% of appointments.", "number not in the data");
  });

  it("keeps a derived percentage when both source numbers are in the sentence", () => {
    keeps("Email set 24 of 111 appointments, 22% of the total.");
  });

  it("never lets a plain data number pass as a percentage", () => {
    // 20 is a real count (C-suite, Q3 2025), but "20%" is a different claim.
    drops("20% of appointments came from the C-suite.", "number not in the data");
    keeps("20 of 100 titled appointments, 20%, came from the C-suite.");
  });

  it("treats the word 'percent' like the % sign", () => {
    drops("Email drove 22 percent of appointments.", "number not in the data");
  });
});

describe("ratios", () => {
  it("keeps a ratio the data already provides", () => {
    // insights.quarters.peakVsLowTimes = 35 / 20 = 1.8
    keeps("The peak quarter produced 1.8 times the lowest.");
  });

  it("drops a derived ratio without its source numbers", () => {
    drops("LinkedIn produced 3.6x more appointments than email.", "number not in the data");
  });

  it("keeps a derived ratio with both source numbers", () => {
    keeps("LinkedIn set 87 appointments against 24 from email, 3.6x more.");
  });
});

describe("claims the data can never back", () => {
  it("drops money claims", () => {
    drops("The program added $2 million in pipeline.", "money claim");
    drops("Callbox delivered a strong ROI.", "money claim");
  });

  it("drops forecasts", () => {
    drops("Callbox expects to double appointments next year.", "forecast");
    drops("The program is on track to reach 200 meetings.", "forecast");
    drops("LinkedIn will generate more pipeline in 2027.", "forecast");
  });
});

describe("house style", () => {
  it("replaces em dashes and spaced hyphens with commas", () => {
    expect(guard("LinkedIn led — with 87 appointments.").text).toBe("LinkedIn led, with 87 appointments.");
    expect(guard("LinkedIn led - with 87 appointments.").text).toBe("LinkedIn led, with 87 appointments.");
  });

  it("returns empty text for empty input", () => {
    expect(guard("").text).toBe("");
    expect(guard("   ").text).toBe("");
  });
});
