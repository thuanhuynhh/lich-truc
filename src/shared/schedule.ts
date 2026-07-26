export const SCHEDULE_UNITS: SeedUnit[] = [
  // ================= PHẦN I: LỊCH TRỰC (Ngoài giờ hành chính) =================
  { code: "duty_common", section: "I", label: "LỊCH TRỰC CHUNG", type: "duty_common", maxPerDay: null, sortOrder: 10, computed: true },
  { code: "duty_bs_c1", section: "I", label: "BÁC SĨ TRỰC (CỘT 1)", type: "duty_bs", maxPerDay: 1, sortOrder: 20, computed: false },
  { code: "duty_bs_c2", section: "I", label: "BÁC SĨ TRỰC (CỘT 2)", type: "duty_bs", maxPerDay: null, sortOrder: 30, computed: false },
  { code: "duty_dd", section: "I", label: "ĐIỀU DƯỠNG TRỰC", type: "duty_ktv", maxPerDay: null, sortOrder: 40, computed: false },
  
  // Dòng nghỉ phép tổng quát của hệ thống (cần giữ lại để phần mềm không báo lỗi)
  { code: "leave", section: "I", label: "NGHỈ PHÉP (HỆ THỐNG)", type: "leave", maxPerDay: null, sortOrder: 50, computed: true },

  // ================= PHẦN II: PHÂN CÔNG BÁC SĨ (Giờ hành chính) =================
  { code: "pk_a_sang", section: "II", label: "PHÒNG KHÁM A (SÁNG)", type: "work_bs", maxPerDay: 2, sortOrder: 110, computed: false },
  { code: "pk_a_chieu", section: "II", label: "PHÒNG KHÁM A (CHIỀU)", type: "work_bs", maxPerDay: 1, sortOrder: 120, computed: false },
  { code: "pk_b", section: "II", label: "PHÒNG KHÁM B (CẢ NGÀY)", type: "work_bs", maxPerDay: 1, sortOrder: 130, computed: false },
  { code: "bs_ra_truc", section: "II", label: "BÁC SĨ RA TRỰC", type: "work_bs", maxPerDay: null, sortOrder: 140, computed: false },
  { code: "bs_nghi_phep", section: "II", label: "BÁC SĨ NGHỈ PHÉP", type: "work_bs", maxPerDay: null, sortOrder: 150, computed: false },
  { code: "bs_cong_tac", section: "II", label: "BÁC SĨ ĐI CÔNG TÁC", type: "work_bs", maxPerDay: null, sortOrder: 160, computed: false },

  // ================= PHẦN III: PHÂN CÔNG ĐIỀU DƯỠNG (Giờ hành chính) =================
  { code: "dd_buong_benh", section: "III", label: "ĐIỀU DƯỠNG BUỒNG BỆNH", type: "work_ktv", maxPerDay: null, sortOrder: 210, computed: false },
  { code: "dd_khu_a", section: "III", label: "ĐIỀU DƯỠNG KHU A", type: "work_ktv", maxPerDay: null, sortOrder: 220, computed: false },
  { code: "dd_khu_b", section: "III", label: "ĐIỀU DƯỠNG KHU B", type: "work_ktv", maxPerDay: null, sortOrder: 230, computed: false },
  { code: "dd_khu_c", section: "III", label: "ĐIỀU DƯỠNG KHU C", type: "work_ktv", maxPerDay: null, sortOrder: 240, computed: false },
  { code: "dd_ra_truc", section: "III", label: "ĐIỀU DƯỠNG RA TRỰC", type: "work_ktv", maxPerDay: null, sortOrder: 250, computed: false },
  { code: "dd_nghi_phep", section: "III", label: "ĐIỀU DƯỠNG NGHỈ PHÉP", type: "work_ktv", maxPerDay: null, sortOrder: 260, computed: false }
];