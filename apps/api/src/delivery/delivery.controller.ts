import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { RequestActorService } from "../identity/request-actor.service.js";
import type { LotQuantity } from "../inventory/inventory.repository.js";
import type { ConditionEvidence } from "./delivery.repository.js";
import { DeliveryService } from "./delivery.service.js";
@Controller("v1/deliveries")
export class DeliveryController {
  constructor(@Inject(RequestActorService) private actors: RequestActorService, @Inject(DeliveryService) private delivery: DeliveryService) {}
  @Post() async create(@Req() req: Request, @Body() b: unknown, @Res({ passthrough: true }) res: Response) { const d = await this.delivery.create(await this.actors.fromRequest(req), str(b,"rfqId"), str(b,"tradeId"), str(b,"logisticsOrganizationId"), str(b,"assignedLogisticsUserId")); res.setHeader("ETag", d.etag); return { data: d }; }
  @Get(":id") async get(@Req() req: Request, @Param("id") id: string, @Res({ passthrough: true }) res: Response) { const d = await this.delivery.get(await this.actors.fromRequest(req), id); res.setHeader("ETag", d.etag); return { data: d }; }
  @Post(":id/milestones/:status") @HttpCode(200) async milestone(@Req() req: Request, @Param("id") id: string, @Param("status") status: string, @Headers("if-match") etag: string | undefined, @Body() b: unknown, @Res({ passthrough: true }) res: Response) { if (!["pickedUp","inTransit","arrived"].includes(status)) throw new BadRequestException("Invalid milestone"); const d = await this.delivery.milestone(await this.actors.fromRequest(req), id, status as "pickedUp"|"inTransit"|"arrived", evidence(b), tag(etag)); res.setHeader("ETag", d.etag); return { data: d }; }
  @Post(":id/pod") @HttpCode(200) async pod(@Req() req: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() b: unknown, @Res({ passthrough: true }) res: Response) { const d = await this.delivery.submitPod(await this.actors.fromRequest(req), id, str(b,"recipientName"), str(b,"evidenceReference"), evidence(b), tag(etag)); res.setHeader("ETag", d.etag); return { data: d }; }
  @Post(":id/decision") @HttpCode(200) async decision(@Req() req: Request, @Param("id") id: string, @Headers("if-match") etag: string | undefined, @Body() b: unknown, @Res({ passthrough: true }) res: Response) { const d = await this.delivery.decide(await this.actors.fromRequest(req), id, qty(prop(b,"acceptedQuantity")), qty(prop(b,"rejectedQuantity")), optional(b,"rejectionReason"), tag(etag)); res.setHeader("ETag", d.etag); return { data: d }; }
}
function prop(b: unknown,n:string){if(typeof b!=="object"||b===null||!(n in b))throw new BadRequestException(`${n} is required`);return (b as Record<string,unknown>)[n];}
function str(b:unknown,n:string){const v=prop(b,n);if(typeof v!=="string"||v.trim()==="")throw new BadRequestException(`${n} must be a string`);return v.trim();}
function optional(b:unknown,n:string){if(typeof b!=="object"||b===null||!(n in b))return undefined;return str(b,n);}
function integer(b:unknown,n:string){const v=prop(b,n);if(typeof v!=="number"||!Number.isSafeInteger(v))throw new BadRequestException(`${n} must be an integer`);return v;}
function qty(b:unknown):LotQuantity{return{value:integer(b,"value"),scale:integer(b,"scale"),unitCode:str(b,"unitCode").toUpperCase()};}
function evidence(b:unknown):ConditionEvidence{if(typeof b!=="object"||b===null)return{};const r=b as Record<string,unknown>;const out:Record<string,unknown>={};for(const k of ["temperatureMilliC","oxygenMilliPercent"]){if(r[k]!==undefined){if(typeof r[k]!=="number"||!Number.isSafeInteger(r[k]))throw new BadRequestException(`${k} must be an integer`);out[k]=r[k];}}for(const k of ["location","notes"]){if(r[k]!==undefined){if(typeof r[k]!=="string")throw new BadRequestException(`${k} must be a string`);out[k]=r[k];}}return out as ConditionEvidence;}
function tag(v:string|undefined){if(!v)throw new BadRequestException("If-Match header is required");return v;}