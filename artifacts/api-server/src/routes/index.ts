import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deliveriesRouter from "./deliveries";
import courierRoutesRouter from "./courier-routes";
import storeManagementRouter from "./store-management";
import pushRouter from "./push";
import erpAdminRouter from "./erp-admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(pushRouter);
router.use(storeManagementRouter);
router.use(erpAdminRouter);
router.use(deliveriesRouter);
router.use(courierRoutesRouter);

export default router;
