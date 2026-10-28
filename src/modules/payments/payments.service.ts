import { db } from '../../infrastructure/database/db.js';
import {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  UnauthorizedError,
} from '../../common/errors/AppError.js';
import { verifyHmacSignature } from '../../common/security/crypto.js';
import { env } from '../../config/env.js';
import { paymentEventsCounter } from '../../common/observability/metrics.js';
import { OutboxService } from '../../infrastructure/outbox/outbox.service.js';

export class PaymentsService {
  async createPaymentIntent(patientId: string, appointmentId: string) {
    const appointment = db.findById('appointments', appointmentId);
    if (!appointment) throw new NotFoundError('Appointment not found');

    if (appointment.patient_id !== patientId) {
      throw new ForbiddenError('You can only pay for your own appointments');
    }

    if (appointment.status === 'CANCELLED') {
      throw new BadRequestError('Cannot initiate payment for a cancelled appointment');
    }

    // Check existing payment
    let payment = db.findOne('payments', (p) => p.appointment_id === appointmentId);
    if (payment && payment.status === 'SUCCEEDED') {
      throw new BadRequestError('Payment for this appointment has already succeeded');
    }

    if (!payment) {
      payment = db.insert('payments', {
        appointment_id: appointmentId,
        patient_id: patientId,
        amount: appointment.amount,
        currency: 'INR',
        status: 'PROCESSING',
        provider: 'STRIPE',
        provider_transaction_id: `pi_mock_${Date.now()}`,
      });
    } else {
      payment = db.update('payments', payment.id as string, {
        status: 'PROCESSING',
      })!;
    }

    return {
      paymentId: payment.id,
      appointmentId,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      clientSecret: `pi_secret_mock_${payment.id}`,
    };
  }

  async getPaymentById(actorId: string, role: string, paymentId: string) {
    const payment = db.findById('payments', paymentId);
    if (!payment) throw new NotFoundError('Payment not found');

    if (role === 'PATIENT' && payment.patient_id !== actorId) {
      throw new ForbiddenError('You are not authorized to view this payment');
    }

    return payment;
  }

  async processWebhook(_provider: string, signature: string | undefined, rawPayload: string, event: {
    id: string;
    type: string;
    data: {
      object: {
        id: string;
        amount: number;
        status: string;
        metadata?: { appointmentId?: string };
      };
    };
  }) {
    // 1. Verify HMAC Signature
    if (!signature) {
      paymentEventsCounter.inc({ event_type: event.type, status: 'missing_signature' });
      throw new UnauthorizedError('Missing webhook signature header');
    }

    const isValid = verifyHmacSignature(rawPayload, signature, env.WEBHOOK_SECRET_STRIPE);
    if (!isValid) {
      paymentEventsCounter.inc({ event_type: event.type, status: 'invalid_signature' });
      throw new UnauthorizedError('Invalid payment webhook signature');
    }

    const transactionId = event.data.object.id;
    const appointmentId = event.data.object.metadata?.appointmentId;

    // 2. Idempotent Deduplication Check
    const existingPayment = db.findOne('payments', (p) => p.provider_transaction_id === transactionId);
    if (existingPayment && existingPayment.status === 'SUCCEEDED') {
      paymentEventsCounter.inc({ event_type: event.type, status: 'duplicate_ignored' });
      return { received: true, message: 'Duplicate event ignored' };
    }

    // 3. Process Event Type
    if (event.type === 'payment_intent.succeeded') {
      let targetPayment = existingPayment;
      if (!targetPayment && appointmentId) {
        targetPayment = db.findOne('payments', (p) => p.appointment_id === appointmentId);
      }

      if (targetPayment) {
        db.update('payments', targetPayment.id as string, {
          status: 'SUCCEEDED',
          provider_transaction_id: transactionId,
        });

        // Ensure appointment is marked CONFIRMED
        db.update('appointments', targetPayment.appointment_id as string, {
          status: 'CONFIRMED',
        });

        OutboxService.recordEvent('PAYMENT_SUCCEEDED', {
          paymentId: targetPayment.id,
          appointmentId: targetPayment.appointment_id,
          amount: targetPayment.amount,
          transactionId,
        });
      }

      paymentEventsCounter.inc({ event_type: event.type, status: 'success' });
      return { received: true, status: 'processed_success' };
    }

    if (event.type === 'payment_intent.payment_failed') {
      if (existingPayment) {
        db.update('payments', existingPayment.id as string, {
          status: 'FAILED',
        });
      }
      paymentEventsCounter.inc({ event_type: event.type, status: 'failed' });
      return { received: true, status: 'processed_failure' };
    }

    return { received: true, status: 'unhandled_event_type' };
  }
}

export const paymentsService = new PaymentsService();
