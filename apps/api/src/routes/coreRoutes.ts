import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requirePermission } from '../middleware/auth.js';
import { uploadEvidence } from '../middleware/upload.js';
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  lookupCustomerByPhone,
  updateCustomer,
} from '../controllers/customerController.js';
import {
  createDevice,
  deleteDevice,
  getDevice,
  listDeviceFiles,
  listDevices,
  problematicDevices,
  suggestPartsForDevice,
  updateDevice,
} from '../controllers/deviceController.js';
import {
  addTicketNote,
  assignTechnician,
  changeTicketStatus,
  createTicket,
  getTicket,
  getTicketTimeline,
  listTickets,
  logWork,
  myJobs,
  saveDiagnosis,
  ticketBoard,
  ticketSlaReport,
  updateTicket,
  uploadTicketEvidence,
} from '../controllers/ticketController.js';
import {
  addNoteSchema,
  assignTechnicianSchema,
  createCustomerSchema,
  createDeviceSchema,
  createTicketSchema,
  diagnosisSchema,
  listCustomersQuerySchema,
  listDevicesQuerySchema,
  listTicketsQuerySchema,
  transitionTicketSchema,
  updateCustomerSchema,
  updateDeviceSchema,
  updateTicketSchema,
  workLogSchema,
} from '../validators/coreValidators.js';

/* ----------------------------- العملاء ----------------------------- */
export const customerRouter = Router();

customerRouter.get('/', requirePermission('customer:read'), validate(listCustomersQuerySchema, 'query'), listCustomers);
customerRouter.get('/lookup', requirePermission('customer:read'), lookupCustomerByPhone);
customerRouter.get('/:id', requirePermission('customer:read'), getCustomer);
customerRouter.post('/', requirePermission('customer:create'), validate(createCustomerSchema), createCustomer);
customerRouter.patch('/:id', requirePermission('customer:update'), validate(updateCustomerSchema), updateCustomer);
customerRouter.delete('/:id', requirePermission('customer:delete'), deleteCustomer);

/* ----------------------------- الأجهزة ----------------------------- */
export const deviceRouter = Router();

deviceRouter.get('/', requirePermission('device:read'), validate(listDevicesQuerySchema, 'query'), listDevices);
deviceRouter.get('/problematic', requirePermission('device:read'), problematicDevices);
deviceRouter.get('/files', requirePermission('evidence:read'), listDeviceFiles);
deviceRouter.get('/:id', requirePermission('device:read'), getDevice);
deviceRouter.get('/:id/suggested-parts', requirePermission('part:read'), suggestPartsForDevice);
deviceRouter.post('/', requirePermission('device:create'), validate(createDeviceSchema), createDevice);
deviceRouter.patch('/:id', requirePermission('device:update'), validate(updateDeviceSchema), updateDevice);
deviceRouter.delete('/:id', requirePermission('device:delete'), deleteDevice);

/* -------------------------- تذاكر الصيانة -------------------------- */
export const ticketRouter = Router();

ticketRouter.get('/', requirePermission('ticket:read'), validate(listTicketsQuerySchema, 'query'), listTickets);
ticketRouter.get('/board', requirePermission('ticket:read'), ticketBoard);
ticketRouter.get('/sla-report', requirePermission('ticket:read'), ticketSlaReport);
ticketRouter.get('/my-jobs', requirePermission('ticket:read'), myJobs);

ticketRouter.post('/', requirePermission('ticket:create'), validate(createTicketSchema), createTicket);
ticketRouter.get('/:id', requirePermission('ticket:read'), getTicket);
ticketRouter.patch('/:id', requirePermission('ticket:update'), validate(updateTicketSchema), updateTicket);
ticketRouter.post(
  '/:id/transition',
  requirePermission('ticket:transition'),
  validate(transitionTicketSchema),
  changeTicketStatus,
);
ticketRouter.post('/:id/assign', requirePermission('ticket:assign'), validate(assignTechnicianSchema), assignTechnician);
ticketRouter.put('/:id/diagnosis', requirePermission('diagnosis:write'), validate(diagnosisSchema), saveDiagnosis);
ticketRouter.post('/:id/notes', requirePermission('ticket:update'), validate(addNoteSchema), addTicketNote);
ticketRouter.post('/:id/work-log', requirePermission('ticket:update'), validate(workLogSchema), logWork);
ticketRouter.get('/:id/timeline', requirePermission('ticket:read'), getTicketTimeline);
ticketRouter.post('/:id/evidence', requirePermission('evidence:upload'), uploadEvidence, uploadTicketEvidence);
