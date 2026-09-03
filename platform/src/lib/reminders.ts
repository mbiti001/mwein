export function appointmentReminder(input: {
  patientName: string;
  facilityName: string;
  clinic: string;
  scheduledAt: Date;
}) {
  const firstName = input.patientName.trim().split(/\s+/)[0] || "there";
  const when = input.scheduledAt.toLocaleString("en-KE", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return `Hello ${firstName}, this is a reminder of your ${input.clinic} appointment at ${input.facilityName} on ${when}. Please arrive 15 minutes early. Reply or call the facility if you need to reschedule.`;
}
