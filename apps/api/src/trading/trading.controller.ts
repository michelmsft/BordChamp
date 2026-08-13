import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RequestActorService } from "../identity/request-actor.service.js";
import { TradingService } from "./trading.service.js";

@Controller("v1/trading/rfqs")
export class TradingController {
  constructor(@Inject(RequestActorService) private actors: RequestActorService, @Inject(TradingService) private trading: TradingService) {}
  @Post() async create(@Req() req: Request, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const buyers = stringArray(body, "invitedBuyerOrganizationIds");
    const rfq = await this.trading.createSellRfq(await this.actors.fromRequest(req), stringValue(body, "lotId"), buyers, isoDate(body, "expiresAt"));
    res.setHeader("ETag", rfq.etag); return { data: rfq };
  }
  @Get(":id") async get(@Req() req: Request, @Param("id") id: string, @Res({ passthrough: true }) res: Response) {
    const data = await this.trading.get(await this.actors.fromRequest(req), id); res.setHeader("ETag", data.rfq.etag); return { data };
  }
  @Post(":id/quotes") async quote(@Req() req: Request, @Param("id") id: string, @Body() body: unknown) {
    return { data: await this.trading.quote(await this.actors.fromRequest(req), id, integerValue(body, "unitPriceMinor")) };
  }
  @Post(":id/cancel") @HttpCode(200) async cancel(@Req() req: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const rfq = await this.trading.cancel(await this.actors.fromRequest(req), id, stringValue(body, "reason"), requireEtag(etag)); res.setHeader("ETag", rfq.etag); return { data: rfq };
  }
  @Post(":id/accept") @HttpCode(200) async accept(@Req() req: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const data = await this.trading.accept(await this.actors.fromRequest(req), id, stringValue(body, "quoteId"), requireEtag(etag)); res.setHeader("ETag", data.rfq.etag); return { data };
  }
}
function prop(body: unknown, name: string) { if (typeof body !== "object" || body === null || !(name in body)) throw new BadRequestException(`${name} is required`); return (body as Record<string, unknown>)[name]; }
function stringValue(body: unknown, name: string) { const value = prop(body, name); if (typeof value !== "string" || value.trim().length === 0) throw new BadRequestException(`${name} must be a non-empty string`); return value.trim(); }
function integerValue(body: unknown, name: string) { const value = prop(body, name); if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new BadRequestException(`${name} must be a safe integer`); return value; }
function stringArray(body: unknown, name: string) { const value = prop(body, name); if (!Array.isArray(value) || !value.every(x => typeof x === "string" && x.length > 0)) throw new BadRequestException(`${name} must be a string array`); return value as string[]; }
function isoDate(body: unknown, name: string) { const value = stringValue(body, name); if (!Number.isFinite(new Date(value).getTime())) throw new BadRequestException(`${name} must be an ISO date`); return value; }
function requireEtag(etag: string | undefined) { if (!etag) throw new BadRequestException("If-Match header is required"); return etag; }