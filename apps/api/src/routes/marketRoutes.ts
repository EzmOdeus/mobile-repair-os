import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { requirePermission } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import {
  createMarketListing,
  createMarketOffer,
  decideMarketOffer,
  deleteMarketListingImage,
  getMarketListing,
  listMarketListings,
  listingOffers,
  marketStats,
  markMarketListingSold,
  myMarketListings,
  myMarketOffers,
  removeMarketListing,
  reopenMarketListing,
  updateMarketListing,
  uploadMarketListingImages,
} from '../controllers/marketController.js';
import { listMarketPrices, valuatePhone } from '../controllers/marketPriceController.js';
import {
  createMarketListingSchema,
  createMarketOfferSchema,
  decideMarketOfferSchema,
  markMarketListingSoldSchema,
  removeMarketListingSchema,
  updateMarketListingSchema,
} from '../validators/marketValidators.js';

/**
 * ماركت بلس: سوق عام بين المراكز + سوق داخلي بين فروع نفس المركز.
 * الإعلان العام يُنشر بعد مراجعة المنصة (/platform/market)، والداخلي فورًا.
 * التعاملات المالية والتسليم خارج النظام — العروض والقبول وتوثيق التواصل فقط.
 */
const marketRouter = Router();

marketRouter.get('/stats', requirePermission('market:read'), marketStats);
marketRouter.get('/listings', requirePermission('market:read'), listMarketListings);
marketRouter.get('/my/listings', requirePermission('market:read'), myMarketListings);
marketRouter.get('/my/offers', requirePermission('market:read'), myMarketOffers);
marketRouter.get('/prices/valuation', requirePermission('market:read'), valuatePhone);
marketRouter.get('/prices', requirePermission('market:read'), listMarketPrices);

marketRouter.post(
  '/listings',
  requirePermission('market:manage'),
  validate(createMarketListingSchema),
  createMarketListing,
);
marketRouter.get('/listings/:id', requirePermission('market:read'), getMarketListing);
marketRouter.patch(
  '/listings/:id',
  requirePermission('market:manage'),
  validate(updateMarketListingSchema),
  updateMarketListing,
);
marketRouter.delete(
  '/listings/:id',
  requirePermission('market:manage'),
  validate(removeMarketListingSchema),
  removeMarketListing,
);

marketRouter.post(
  '/listings/:id/images',
  requirePermission('market:manage'),
  upload.array('files', 6),
  uploadMarketListingImages,
);
marketRouter.delete(
  '/listings/:id/images/:fileId',
  requirePermission('market:manage'),
  deleteMarketListingImage,
);

marketRouter.get('/listings/:id/offers', requirePermission('market:manage'), listingOffers);
marketRouter.post(
  '/listings/:id/offers',
  requirePermission('market:manage'),
  validate(createMarketOfferSchema),
  createMarketOffer,
);
marketRouter.post(
  '/listings/:id/mark-sold',
  requirePermission('market:manage'),
  validate(markMarketListingSoldSchema),
  markMarketListingSold,
);
marketRouter.post('/listings/:id/reopen', requirePermission('market:manage'), reopenMarketListing);

marketRouter.patch(
  '/offers/:id',
  requirePermission('market:manage'),
  validate(decideMarketOfferSchema),
  decideMarketOffer,
);

export default marketRouter;
