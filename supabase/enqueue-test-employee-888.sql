-- ทดสอบคิวนำเข้าพนักงาน: สั่งเพิ่มรหัส 888 เข้าเครื่องสแกนของทุกสาขา
--
-- Store 2 ใช้ MB40-VL ซึ่งต่างจากสาขาอื่นที่ใช้ K50/ID (attendance packet 49 vs 40 ไบต์)
-- และเคยพบชื่อที่อ่านกลับมามีขยะต่อท้ายจนเต็ม 24 ไบต์ จึงต้องทดสอบแยกก่อนใช้งานจริง
-- รันใน Supabase SQL Editor หลังรัน migration ใน supabase/migrations แล้ว
--
-- ไม่แตะลายนิ้วมือหรือใบหน้า — สร้างเฉพาะโปรไฟล์ (รหัส/ชื่อ/เลขบัตร) บนเครื่อง
-- ถ้ารหัส 888 มีอยู่แล้วในเครื่อง ระบบจะแก้ชื่อของ uid เดิม ไม่สร้างซ้ำ

insert into public.device_employee_import_queue
  (branch, employee_code, employee_name, request_key)
values
  ('Store 1', '888', 'ทดสอบ 888', 'test-888-store1-v1'),
  ('Store 2', '888', 'ทดสอบ 888', 'test-888-store2-v1'),
  ('Store 3', '888', 'ทดสอบ 888', 'test-888-store3-v1'),
  ('Store 4', '888', 'ทดสอบ 888', 'test-888-store4-v1'),
  ('Store 5', '888', 'ทดสอบ 888', 'test-888-store5-v1');

-- ดูผลหลังจากนั้น: pending -> processing -> completed
-- ถ้าเป็น retry/failed ให้ดู last_error (เช่น ต่อเครื่องไม่ได้ หรือ ZKBioTime ยึดการเชื่อมต่ออยู่)
select branch, employee_code, status, attempts, device_uid, last_error, updated_at
  from public.device_employee_import_queue
 where employee_code = '888'
 order by branch;

-- ยกเลิกงานที่ยังไม่ทำ (ถ้าต้องการหยุดกลางคัน)
-- update public.device_employee_import_queue
--    set status = 'cancelled', processed_at = now()
--  where employee_code = '888' and status in ('pending', 'retry');
