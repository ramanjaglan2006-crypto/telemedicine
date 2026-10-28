import { db } from '../../infrastructure/database/db.js';

export class AdminService {
  async getOverviewAnalytics() {
    const allAppointments = db.find('appointments');
    const allConsultations = db.find('consultations');
    const allPayments = db.find('payments');
    const allDoctors = db.find('doctors');
    const allSlots = db.find('availability_slots');

    // Appointment status counts
    const appointmentsByStatus: Record<string, number> = {};
    for (const app of allAppointments) {
      const status = app.status as string;
      appointmentsByStatus[status] = (appointmentsByStatus[status] || 0) + 1;
    }

    // Cancellation rate
    const totalAppointments = allAppointments.length;
    const cancelledCount = appointmentsByStatus['CANCELLED'] || 0;
    const cancellationRate = totalAppointments > 0 ? Number(((cancelledCount / totalAppointments) * 100).toFixed(2)) : 0;

    // Consultation status counts
    const consultationsByStatus: Record<string, number> = {};
    for (const c of allConsultations) {
      const status = c.status as string;
      consultationsByStatus[status] = (consultationsByStatus[status] || 0) + 1;
    }

    // Financial calculations
    let totalRevenue = 0;
    let successfulPayments = 0;
    let failedPayments = 0;

    for (const p of allPayments) {
      if (p.status === 'SUCCEEDED') {
        totalRevenue += Number(p.amount) || 0;
        successfulPayments += 1;
      } else if (p.status === 'FAILED') {
        failedPayments += 1;
      }
    }

    // Doctor utilization rate (Booked slots / Total non-cancelled slots)
    const validSlots = allSlots.filter((s) => s.status !== 'CANCELLED');
    const bookedSlots = validSlots.filter((s) => s.status === 'BOOKED');
    const doctorUtilizationRate = validSlots.length > 0 ? Number(((bookedSlots.length / validSlots.length) * 100).toFixed(2)) : 0;

    return {
      appointments: {
        total: totalAppointments,
        byStatus: appointmentsByStatus,
        cancellationRatePercent: cancellationRate,
      },
      consultations: {
        total: allConsultations.length,
        byStatus: consultationsByStatus,
      },
      payments: {
        totalVolume: allPayments.length,
        successfulCount: successfulPayments,
        failedCount: failedPayments,
        totalRevenueINR: totalRevenue,
      },
      capacity: {
        totalVerifiedDoctors: allDoctors.length,
        totalSlotsConfigured: validSlots.length,
        bookedSlots: bookedSlots.length,
        utilizationRatePercent: doctorUtilizationRate,
      },
    };
  }

  async getAuditLogs(filters: { action?: string; limit?: number }) {
    const limit = Math.min(100, Math.max(1, filters.limit || 50));
    const logs = db.find('audit_logs', (log) => {
      if (filters.action && log.action !== filters.action) return false;
      return true;
    });

    // Return newest first
    return logs
      .sort((a, b) => new Date(b.created_at as string).getTime() - new Date(a.created_at as string).getTime())
      .slice(0, limit);
  }
}

export const adminService = new AdminService();
