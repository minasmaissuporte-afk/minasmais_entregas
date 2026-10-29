import { Router, type IRouter } from "express";
import healthRouter from "./health";
import deliveriesRouter from "./deliveries";
import courierRoutesRouter from "./courier-routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use(deliveriesRouter);
router.use(courierRoutesRouter);

export default router;
