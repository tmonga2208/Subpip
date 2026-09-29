// Email through the owner's Gmail (SMTP + app password). Returns null when
// not configured, so callers can degrade instead of crashing.
import nodemailer from 'nodemailer';

export function createMailer({ user, pass }) {
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  return {
    send: (message) => transport.sendMail({ from: `SubPIP <${user}>`, ...message })
  };
}
