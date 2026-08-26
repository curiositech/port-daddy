export class Conductor {
  private workIntentService: WorkIntentService;
  private dispatcher: Dispatcher;

  constructor() {
    this.workIntentService = new WorkIntentService();
    this.dispatcher = new Dispatcher();
  }

  public async handleLaunch(launch: LaunchIntent) {
    const workIntent = await this.workIntentService.create(launch);
    await this.dispatcher.queue(workIntent);
  }
}