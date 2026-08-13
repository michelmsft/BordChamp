import { Controller, Get } from "@nestjs/common";
import { Public } from "../identity/public-route.js";

@Public()
@Controller("health")
export class HealthController {
  @Get()
  getHealth(): { readonly status: "ok" } {
    return { status: "ok" };
  }
}