const express = require('express');
const { body, param } = require('express-validator');
const flatController = require('../controllers/flatController');
const { handleValidationErrors } = require('../middleware/validateMiddleware');

const router = express.Router();

// Open direct routes — No login or authentication required
router.get('/', flatController.listFlats);
router.get('/existing-keys', flatController.getExistingFlatKeys);
router.get('/export', flatController.exportFlats);

router.post(
  '/',
  [
    body('flatNumber')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Flat Number is required.'),
    body('ownerName')
      .trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Owner Name must be between 2 and 150 characters.'),
    body('mobileNumber')
      .optional({ values: 'falsy' })
      .trim()
      .isLength({ max: 25 })
      .withMessage('Mobile Number cannot exceed 25 characters.')
  ],
  handleValidationErrors,
  flatController.createFlat
);

router.post(
  '/bulk-import',
  [body('rows').isArray({ min: 1 }).withMessage('Rows array is required for Excel/CSV import.')],
  handleValidationErrors,
  flatController.bulkImportFlats
);

router.put(
  '/:id',
  [
    param('id').isInt({ min: 1 }).withMessage('Valid Flat ID is required.'),
    body('flatNumber')
      .trim()
      .isLength({ min: 1, max: 50 })
      .withMessage('Flat Number is required.'),
    body('ownerName')
      .trim()
      .isLength({ min: 2, max: 150 })
      .withMessage('Owner Name must be between 2 and 150 characters.')
  ],
  handleValidationErrors,
  flatController.updateFlat
);

router.patch(
  '/:id/status',
  [param('id').isInt({ min: 1 }).withMessage('Valid Flat ID is required.')],
  handleValidationErrors,
  flatController.toggleParticipation
);

router.delete(
  '/:id',
  [param('id').isInt({ min: 1 }).withMessage('Valid Flat ID is required.')],
  handleValidationErrors,
  flatController.deleteFlat
);

module.exports = router;
