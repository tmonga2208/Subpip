// Email through the owner's Gmail (SMTP + app password). Returns null when
// not configured, so callers can degrade instead of crashing.
import nodemailer from 'nodemailer';

// Short timeouts: a hung SMTP connection must not outlive the function
export function mailerOptions(user, pass) {
  return {
    service: 'gmail',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  };
}

export function createMailer({ user, pass }) {
  if (!user || !pass) return null;
  const transport = nodemailer.createTransport(mailerOptions(user, pass));
  return {
    send: (message) => transport.sendMail({ from: `SubPIP <${user}>`, ...message })
  };
}
