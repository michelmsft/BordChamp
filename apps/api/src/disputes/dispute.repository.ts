import { TableClient, TableTransaction, type TableEntity } from "@azure/data-tables";
import { randomUUID } from "node:crypto";
import { createTableClient, hasTableStorageConfiguration } from "../storage/table-client.js";

export const DISPUTE_REPOSITORY = Symbol("DISPUTE_REPOSITORY");
export interface Dispute {
  readonly id: string; readonly deliveryId: string; readonly settlementId: string;
  readonly tradeId: string; readonly sellerOrganizationId: string; readonly buyerOrganizationId: string;
  readonly filedByOrganizationId: string; readonly reasonCode: string; readonly description: string;
  readonly status: "open" | "mediation" | "resolved";
  readonly remedy?: "release" | "refund"; readonly rationale?: string;
  readonly decidedByUserId?: string; readonly createdAt: string; readonly updatedAt: string;
  readonly resolvedAt?: string; readonly etag: string;
}
export interface DisputeEvidence { readonly id: string; readonly organizationId: string;
  readonly evidenceReference: string; readonly description: string; readonly submittedAt: string; }
export interface DisputeResponse { readonly id: string; readonly organizationId: string;
  readonly message: string; readonly evidenceReferences: readonly string[]; readonly submittedAt: string; }
export class DisputeConflictError extends Error {}
export interface DisputeRepository {
  create(value: Omit<Dispute, "etag">, evidenceReferences: readonly string[], actorUserId: string): Promise<Dispute>;
  get(id: string): Promise<Dispute | undefined>;
  listEvidence(id: string): Promise<readonly DisputeEvidence[]>;
  listResponses(id: string): Promise<readonly DisputeResponse[]>;
  addEvidence(id: string, evidence: DisputeEvidence, actorUserId: string): Promise<void>;
  addResponse(id: string, response: DisputeResponse, actorUserId: string): Promise<void>;
  startMediation(id: string, etag: string, actorUserId: string): Promise<Dispute>;
  resolve(id: string, remedy: "release" | "refund", rationale: string,
    etag: string, actorUserId: string): Promise<Dispute>;
}
interface DisputeEntity extends TableEntity { deliveryId: string; settlementId: string; tradeId: string;
  sellerOrganizationId: string; buyerOrganizationId: string; filedByOrganizationId: string;
  reasonCode: string; description: string; status: "open" | "mediation" | "resolved";
  remedy?: "release" | "refund"; rationale?: string; decidedByUserId?: string;
  createdAt: string; updatedAt: string; resolvedAt?: string; }
function profile(d: Omit<Dispute,"etag">): DisputeEntity { return { partitionKey:d.id,rowKey:"PROFILE",
  deliveryId:d.deliveryId,settlementId:d.settlementId,tradeId:d.tradeId,
  sellerOrganizationId:d.sellerOrganizationId,buyerOrganizationId:d.buyerOrganizationId,
  filedByOrganizationId:d.filedByOrganizationId,reasonCode:d.reasonCode,description:d.description,status:d.status,
  ...(d.remedy===undefined?{}:{remedy:d.remedy}),...(d.rationale===undefined?{}:{rationale:d.rationale}),
  ...(d.decidedByUserId===undefined?{}:{decidedByUserId:d.decidedByUserId}),createdAt:d.createdAt,updatedAt:d.updatedAt,
  ...(d.resolvedAt===undefined?{}:{resolvedAt:d.resolvedAt})}; }
function toDispute(e:DisputeEntity&{etag?:string}):Dispute{return{id:e.partitionKey,deliveryId:e.deliveryId,
  settlementId:e.settlementId,tradeId:e.tradeId,sellerOrganizationId:e.sellerOrganizationId,
  buyerOrganizationId:e.buyerOrganizationId,filedByOrganizationId:e.filedByOrganizationId,
  reasonCode:e.reasonCode,description:e.description,status:e.status,...(e.remedy===undefined?{}:{remedy:e.remedy}),
  ...(e.rationale===undefined?{}:{rationale:e.rationale}),...(e.decidedByUserId===undefined?{}:{decidedByUserId:e.decidedByUserId}),
  createdAt:e.createdAt,updatedAt:e.updatedAt,...(e.resolvedAt===undefined?{}:{resolvedAt:e.resolvedAt}),etag:e.etag??""};}
function event(id:string,type:string,actor:string,at:string,details:string):TableEntity{return{partitionKey:id,rowKey:`EVENT:${at}:${randomUUID()}`,eventType:type,actorUserId:actor,occurredAt:at,details};}
function evidenceEntity(disputeId:string,e:DisputeEvidence):TableEntity{return{partitionKey:disputeId,rowKey:`EVIDENCE:${e.id}`,...e};}
function responseEntity(disputeId:string,r:DisputeResponse):TableEntity{const{evidenceReferences,...rest}=r;return{partitionKey:disputeId,rowKey:`RESPONSE:${r.id}`,...rest,evidenceReferencesJson:JSON.stringify(evidenceReferences)};}
function toEvidence(e:TableEntity&Record<string,unknown>):DisputeEvidence{return{id:e.id as string,organizationId:e.organizationId as string,evidenceReference:e.evidenceReference as string,description:e.description as string,submittedAt:e.submittedAt as string};}
function toResponse(e:TableEntity&Record<string,unknown>):DisputeResponse{return{id:e.id as string,organizationId:e.organizationId as string,message:e.message as string,evidenceReferences:JSON.parse(e.evidenceReferencesJson as string) as string[],submittedAt:e.submittedAt as string};}
abstract class BaseDisputeRepository implements DisputeRepository {
  abstract create(value:Omit<Dispute,"etag">,refs:readonly string[],actor:string):Promise<Dispute>;
  abstract get(id:string):Promise<Dispute|undefined>; abstract listEvidence(id:string):Promise<readonly DisputeEvidence[]>;
  abstract listResponses(id:string):Promise<readonly DisputeResponse[]>; abstract addEvidence(id:string,e:DisputeEvidence,actor:string):Promise<void>;
  abstract addResponse(id:string,r:DisputeResponse,actor:string):Promise<void>;
  abstract change(id:string,etag:string,actor:string,type:string,details:string,apply:(d:Dispute,now:string)=>Dispute):Promise<Dispute>;
  startMediation(id:string,etag:string,actor:string){return this.change(id,etag,actor,"dispute.mediationStarted","mediation",d=>({...d,status:"mediation"}));}
  resolve(id:string,remedy:"release"|"refund",rationale:string,etag:string,actor:string){return this.change(id,etag,actor,"dispute.resolved",remedy,(d,now)=>({...d,status:"resolved",remedy,rationale,decidedByUserId:actor,resolvedAt:now}));}
}
export class InMemoryDisputeRepository extends BaseDisputeRepository {
  private values=new Map<string,Dispute>();private evidence=new Map<string,DisputeEvidence[]>();private responses=new Map<string,DisputeResponse[]>();private version=0;
  async create(v:Omit<Dispute,"etag">,refs:readonly string[]){const x=this.values.get(v.id);if(x)return x;const saved={...v,etag:this.next()};this.values.set(v.id,saved);this.evidence.set(v.id,refs.map((ref,i)=>({id:`FILE-${i+1}`,organizationId:v.filedByOrganizationId,evidenceReference:ref,description:"Initial filing evidence",submittedAt:v.createdAt})));return saved;}
  async get(id:string){return this.values.get(id);}async listEvidence(id:string){return this.evidence.get(id)??[];}async listResponses(id:string){return this.responses.get(id)??[];}
  async addEvidence(id:string,e:DisputeEvidence){this.evidence.set(id,[...(this.evidence.get(id)??[]),e]);}
  async addResponse(id:string,r:DisputeResponse){this.responses.set(id,[...(this.responses.get(id)??[]),r]);}
  async change(id:string,etag:string,_a:string,_t:string,_d:string,apply:(d:Dispute,n:string)=>Dispute){const c=this.values.get(id);if(!c||c.etag!==etag)throw new DisputeConflictError(id);const now=new Date().toISOString();const n={...apply(c,now),updatedAt:now,etag:this.next()};this.values.set(id,n);return n;}private next(){this.version+=1;return`W/\"${this.version}\"`;}}
export class AzureTableDisputeRepository extends BaseDisputeRepository {
  constructor(private table:TableClient){super();}
  async create(v:Omit<Dispute,"etag">,refs:readonly string[],actor:string){const existing=await this.get(v.id);if(existing)return existing;const tx=new TableTransaction();tx.createEntity(profile(v));refs.forEach((ref,i)=>tx.createEntity(evidenceEntity(v.id,{id:`FILE-${i+1}`,organizationId:v.filedByOrganizationId,evidenceReference:ref,description:"Initial filing evidence",submittedAt:v.createdAt})));tx.createEntity(event(v.id,"dispute.filed",actor,v.createdAt,v.deliveryId));await this.submit(tx);return this.require(v.id);}
  async get(id:string){try{return toDispute(await this.table.getEntity<DisputeEntity>(id,"PROFILE"));}catch(e){if(code(e,404))return undefined;throw e;}}
  async listEvidence(id:string){const out:DisputeEvidence[]=[];for await(const e of this.table.listEntities({queryOptions:{filter:`PartitionKey eq '${id}' and RowKey ge 'EVIDENCE:' and RowKey lt 'EVIDENCF:'`}}))out.push(toEvidence(e as TableEntity&Record<string,unknown>));return out;}
  async listResponses(id:string){const out:DisputeResponse[]=[];for await(const e of this.table.listEntities({queryOptions:{filter:`PartitionKey eq '${id}' and RowKey ge 'RESPONSE:' and RowKey lt 'RESPONSF:'`}}))out.push(toResponse(e as TableEntity&Record<string,unknown>));return out;}
  async addEvidence(id:string,e:DisputeEvidence,actor:string){const tx=new TableTransaction();tx.createEntity(evidenceEntity(id,e));tx.createEntity(event(id,"dispute.evidenceAdded",actor,e.submittedAt,e.id));await this.submit(tx);}
  async addResponse(id:string,r:DisputeResponse,actor:string){const tx=new TableTransaction();tx.createEntity(responseEntity(id,r));tx.createEntity(event(id,"dispute.responseAdded",actor,r.submittedAt,r.id));await this.submit(tx);}
  async change(id:string,etag:string,actor:string,type:string,details:string,apply:(d:Dispute,n:string)=>Dispute){const c=await this.require(id);const now=new Date().toISOString();const n={...apply(c,now),updatedAt:now};const tx=new TableTransaction();tx.updateEntity(profile(n),"Replace",{etag});tx.createEntity(event(id,type,actor,now,details));await this.submit(tx);return this.require(id);}
  private async require(id:string){const d=await this.get(id);if(!d)throw new Error("Dispute not found");return d;}private async submit(tx:TableTransaction){try{await this.table.submitTransaction(tx.actions);}catch(e){if(code(e,409)||code(e,412))throw new DisputeConflictError("Dispute conflict");throw e;}}}
function code(e:unknown,v:number){return typeof e==="object"&&e!==null&&"statusCode" in e&&e.statusCode===v;}
export function createDisputeRepository():DisputeRepository{if(!hasTableStorageConfiguration()){if(process.env.NODE_ENV==="production")throw new Error("Azure Table Storage configuration is required in production");return new InMemoryDisputeRepository();}return new AzureTableDisputeRepository(createTableClient(process.env.AZURE_STORAGE_DISPUTES_TABLE??"Disputes"));}