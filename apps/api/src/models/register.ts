/**
 * تسجيل جميع الموديلات في Mongoose.
 * ضروري قبل الاتصال لضمان إنشاء الفهارس (autoIndex في التطوير)
 * ووجود Models في الـregistry قبل أي populate.
 */
import { OrganizationModel } from './Organization.js';
import { BranchModel } from './Branch.js';
import { UserModel } from './User.js';
import { CustomerModel } from './Customer.js';
import { DeviceModel } from './Device.js';
import { StoredFileModel } from './StoredFile.js';
import { RepairTicketModel } from './RepairTicket.js';
import { RepairStatusHistoryModel } from './RepairStatusHistory.js';
import { RepairNoteModel } from './RepairNote.js';
import { SupplierModel } from './Supplier.js';
import { PartModel } from './Part.js';
import { InventoryItemModel } from './InventoryItem.js';
import { StockMovementModel } from './StockMovement.js';
import { StockBatchModel } from './StockBatch.js';
import { StockTransferModel } from './StockTransfer.js';
import { RepairPartModel } from './RepairPart.js';
import { RepairLaborModel } from './RepairLabor.js';
import { EstimateModel } from './Estimate.js';
import { ApprovalModel } from './Approval.js';
import { QualityCheckModel } from './QualityCheck.js';
import { WarrantyClaimModel } from './WarrantyClaim.js';
import { InvoiceModel } from './Invoice.js';
import { PaymentModel } from './Payment.js';
import { ExpenseModel } from './Expense.js';
import { NotificationModel } from './Notification.js';
import { AuditLogModel } from './AuditLog.js';
import { KnowledgeArticleModel } from './KnowledgeArticle.js';

const MODELS = [
  OrganizationModel,
  BranchModel,
  UserModel,
  CustomerModel,
  DeviceModel,
  StoredFileModel,
  RepairTicketModel,
  RepairStatusHistoryModel,
  RepairNoteModel,
  SupplierModel,
  PartModel,
  InventoryItemModel,
  StockMovementModel,
  StockBatchModel,
  StockTransferModel,
  RepairPartModel,
  RepairLaborModel,
  EstimateModel,
  ApprovalModel,
  QualityCheckModel,
  WarrantyClaimModel,
  InvoiceModel,
  PaymentModel,
  ExpenseModel,
  NotificationModel,
  AuditLogModel,
  KnowledgeArticleModel,
] as const;

export function registerAllModels(): string[] {
  return MODELS.map((m) => m.modelName);
}

export { MODELS };
