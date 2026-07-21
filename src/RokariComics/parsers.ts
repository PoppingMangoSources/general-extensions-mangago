/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Inkdex */

export const parseRelativeDate = (text: string): Date | undefined => {
  const match = text.toLowerCase().match(/(\d+|an?)\s*(min(?:ute)?|hour|day|week|month|year)s?\b/);
  if (!match) return undefined;
  const amount = /^\d/.test(match[1]) ? parseInt(match[1], 10) : 1;
  const date = new Date();
  switch (match[2]) {
    case "min":
    case "minute":
      date.setMinutes(date.getMinutes() - amount);
      break;
    case "hour":
      date.setHours(date.getHours() - amount);
      break;
    case "day":
      date.setDate(date.getDate() - amount);
      break;
    case "week":
      date.setDate(date.getDate() - amount * 7);
      break;
    case "month":
      date.setMonth(date.getMonth() - amount);
      break;
    case "year":
      date.setFullYear(date.getFullYear() - amount);
      break;
  }
  return date;
};
