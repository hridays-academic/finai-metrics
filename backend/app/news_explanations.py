"""The long "Why it matters" text for news cards: a cause-and-effect chain
and a 4-6 sentence paragraph per theme and sector, and per company event
type. Generated verbatim from Areas/News explanations (for approval).md,
approved by Hriday on 2026-11-11. Change only with approval."""

THEME_EXPLANATIONS: dict[tuple[str, str], tuple[str, str]] = {
    ('rates', 'economy'): (
        "Repo rate up → banks' loan rates up → people and companies borrow less → spending may slow",
        "The RBI sets the repo rate, the rate at which it lends to banks, and it watches inflation when deciding it. When the rate goes up, banks usually charge more on home, car and business loans, so borrowing becomes dearer. That can cool spending across the economy, which may show up later in companies' sales. Watch the RBI's next policy meeting and the monthly consumer inflation (CPI) release. It depends on how quickly banks pass the change on and how much debt each company and its customers carry.",
    ),
    ('rates', 'autos'): (
        'Rates up → vehicle loan EMIs up → fewer buyers → units sold may fall',
        "Most cars, two-wheelers and tractors in India are bought with a loan, so the monthly EMI matters to buyers. Higher interest rates raise the EMI on the same vehicle, which may push some buyers to wait or choose a cheaper model. That can reach the units sold, the autos KPI, and through it revenue. Watch the company's monthly sales release and banks' vehicle-loan rates. It depends on discounts, festive-season timing and how many buyers pay cash.",
    ),
    ('rates', 'cement'): (
        'Rates up → home loans and project costs up → fewer new buildings → cement volumes may fall',
        "Cement demand comes from homes, offices and infrastructure, and a lot of that building is paid for with loans. Higher rates make home loans and project finance dearer, which may slow new construction. That can reach the tonnes of cement sold, the cement KPI, and revenue. Watch RBI decisions, housing sales figures and the government's infrastructure spending. It depends on the mix: government roads and railways respond much less to interest rates than private housing does, and building plans take months to change.",
    ),
    ('rates', 'fmcg'): (
        'Prices rise faster than incomes → households cut back or switch to cheaper brands → FMCG volumes may slow',
        "Inflation means everyday prices rising, and when food and fuel take a bigger share of the household budget, less is left for other purchases. Some families may buy smaller packs, buy less often or switch to cheaper brands. That can reach underlying volume growth, the FMCG KPI, and revenue. Watch the monthly CPI release, especially food inflation, and the company's comments on rural and urban demand. It depends on the product: essentials like soap hold up better than treats or premium items.",
    ),
    ('crude', 'economy'): (
        "Oil up → India's import bill up → rupee may weaken and inflation may rise",
        'India imports most of the crude oil it uses, so a higher oil price means paying more dollars for the same amount. That can weaken the rupee and push up the prices of fuel, transport and many goods. Higher inflation may in turn affect interest rates and spending. Watch the Brent crude chart and any change in petrol and diesel prices at the pump. It depends on how long the rise lasts and whether the government changes fuel taxes to soften the blow.',
    ),
    ('crude', 'cement'): (
        'Oil up → diesel and freight costs up → cost per tonne up → margin may fall',
        "Cement is heavy, so moving it by truck and rail is one of a cement maker's biggest costs, and diesel prices follow oil. Petcoke, a fuel many kilns burn, also tends to move with oil. When these costs rise faster than the price of cement, the operating margin may fall. Watch the Brent crude chart and the company's comments on freight and fuel cost per tonne. It depends on whether cement prices can rise too, and on fuel bought earlier at lower prices.",
    ),
    ('crude', 'autos'): (
        'Oil up → petrol and diesel prices up → running costs up → some buyers may delay or switch to CNG or electric',
        'Higher fuel prices make a vehicle dearer to run, which may make some buyers wait or pick a CNG or electric model instead. Oil also feeds into plastics, paint and freight, which are costs for carmakers. So it can reach units sold, the autos KPI, and the operating margin. Watch pump prices and the share of CNG and electric vehicles in the monthly sales release. It depends on taxes: pump prices are partly set by the government, so a rise in crude does not always reach buyers.',
    ),
    ('crude', 'fmcg'): (
        'Oil up → plastic packaging and transport costs up → margin may fall unless prices rise',
        'Many everyday products come in plastic packaging made from oil, and moving goods to shops uses diesel. When oil rises, these costs rise, and the operating margin may fall unless the company raises prices. Raising prices protects the margin but may slow volumes. Watch the Brent crude chart and any price increases the company announces. It depends on contracts and stock bought earlier, which can delay the effect by a quarter or two.',
    ),
    ('monsoon', 'economy'): (
        'Good rain → bigger harvest → higher farm incomes and steadier food prices → rural spending may rise',
        "The June to September monsoon brings most of India's rain, and it largely decides how well crops grow. A good monsoon can lift farm incomes and keep food prices in check, while a poor one can do the opposite. Since many Indians depend on farming, rural spending on everything from soap to tractors may follow. Watch the weather department's (IMD) rainfall updates and the progress of kharif sowing. It depends on where and when the rain falls, not just the total, and on how much land has irrigation.",
    ),
    ('monsoon', 'fmcg'): (
        'Good monsoon → higher farm incomes → more rural shopping → FMCG volumes may rise',
        'Rural households buy a large share of everyday products like soap, oil and toothpaste, and their incomes depend a lot on the harvest. A good monsoon can leave them with more to spend, while a poor one can make them cut back. That can reach underlying volume growth, the FMCG KPI, and revenue. Watch IMD rainfall updates and what the company says about rural and urban growth. It depends on crop prices and government support, and the effect usually shows over the following quarters, not at once.',
    ),
    ('monsoon', 'autos'): (
        'Good monsoon → higher farm incomes → more tractor and two-wheeler purchases → units may rise',
        'Tractors are bought mostly by farmers, and two-wheelers and small cars sell strongly in villages, so farm incomes matter. A good monsoon can lift those incomes and with them vehicle purchases, while a weak one may delay them. That can reach units sold, the autos KPI, and revenue. Watch rainfall, kharif sowing and the monthly tractor sales figures. It depends on crop prices, loan availability and the timing of festivals.',
    ),
    ('monsoon', 'cement'): (
        'Heavy rain → building sites slow down → cement demand may dip → July to September volumes may be lower',
        "Construction slows when it rains heavily, so cement demand usually dips during the monsoon. That is why the July to September quarter is often the weakest of the year for cement makers. Very heavy or long rain can reduce tonnes sold, the cement KPI, more than usual, and prices can soften too. Watch rainfall in the regions where the company sells. It depends on comparing with last year's monsoon, since the KPI is growth over the same quarter a year ago.",
    ),
    ('rupee', 'economy'): (
        'Rupee weaker → imports cost more and exports earn more → inflation may rise',
        "The rupee's value against the dollar changes what India pays for imports like oil and electronics and what exporters earn. A weaker rupee makes imports dearer, which can push up prices, but helps exporters. The RBI sometimes steps in to slow sharp moves. Watch the rupee-dollar chart and RBI statements. It depends on how big and how lasting the move is, and on how much each company imports or exports.",
    ),
    ('rupee', 'it'): (
        'Rupee weaker → each dollar earned is worth more rupees → rupee revenue and margin may rise',
        "Indian IT companies bill most of their clients in dollars but pay most salaries in rupees. When the rupee weakens, each dollar of revenue turns into more rupees while costs stay the same, so revenue in rupees and the margin may rise. The constant-currency growth KPI removes this effect on purpose, so it shows only real business growth. Watch the rupee-dollar chart and the company's comments on currency hedges. It depends on hedges, which lock in exchange rates in advance, and on clients asking for lower prices.",
    ),
    ('rupee', 'autos'): (
        'Rupee weaker → imported parts cost more, export sales earn more → margin and revenue may both move',
        'Carmakers import some parts and materials and some also sell vehicles abroad. A weaker rupee raises the cost of imports, which may squeeze the margin, but lifts the rupee value of exports. Some carmakers also pay royalties or buy parts in other currencies such as the yen. Watch the rupee chart and the export line in the monthly sales release. It depends on whether the company imports more than it exports.',
    ),
    ('rupee', 'fmcg'): (
        'Rupee weaker → imported palm oil and other inputs cost more → margin may fall unless prices rise',
        "Several FMCG inputs, such as palm oil, are bought from abroad and priced in dollars. When the rupee weakens, they cost more in rupees, and the operating margin may fall unless the company raises prices. Price increases can protect the margin but may slow volumes. Watch the rupee and palm oil charts and any price changes the company announces. It depends on how much of the company's raw material is imported and whether it has hedged.",
    ),
    ('rupee', 'cement'): (
        'Rupee weaker → imported coal and petcoke cost more → fuel cost per tonne up → margin may fall',
        'Many cement makers import coal or petcoke to fire their kilns, and these are priced in dollars. A weaker rupee raises their cost in rupees, which may raise the cost of each tonne of cement. If cement prices do not rise to match, the operating margin may fall. Watch the rupee and coal charts. It depends on how much fuel is bought locally and how much was bought earlier at older prices.',
    ),
    ('tariffs', 'economy'): (
        'Tariffs abroad up → Indian goods cost more for foreign buyers → exports may fall',
        'A tariff is a tax a country puts on imports. When another country raises tariffs on Indian goods, those goods get dearer for its buyers, and orders may fall. When India changes its own import duties, the cost of imported inputs changes for Indian companies. Watch news of trade deals and government duty notifications. It depends on the product and on whether competing countries face the same tariffs.',
    ),
    ('tariffs', 'it'): (
        'Stricter visas or trade friction → sending staff abroad gets harder or dearer → costs may rise and client decisions may slow',
        'Indian IT companies send some staff to work at client sites, often in the US and Europe, which needs work visas. Stricter visa rules can raise costs, and trade tensions can make clients cautious about new projects. That can reach the margin and constant-currency growth, the IT KPI. Watch US and European visa policy and what clients say in their own results. It depends on how much work the company already does from India.',
    ),
    ('tariffs', 'autos'): (
        'Tariffs on vehicles or parts → export orders and imported component costs change → units and margin may move',
        "Tariffs abroad can change how many Indian-made vehicles and parts sell overseas, and Indian duties can change the cost of imported components. Export volumes are part of the units sold KPI, and component costs affect the margin. Watch trade-agreement news and the export line in monthly sales releases. It depends on how much of the company's sales are exports.",
    ),
    ('tariffs', 'fmcg'): (
        'Import duty on edible oils changes → raw material costs change → margin may move',
        "India imports much of its edible oil, and the government changes import duties from time to time. A higher duty raises the cost of products that use these oils, and a cut lowers it. That can reach the operating margin, and through prices, volumes. Watch duty notifications and the palm oil chart. It depends on how much of the company's range uses imported oils.",
    ),
    ('supply', 'economy'): (
        'Conflict or shipping trouble → longer routes and higher freight and insurance → commodity prices may rise → inflation may rise',
        'Wars and attacks on shipping lanes can force ships onto longer routes and raise insurance costs. That can make oil and other commodities dearer for India and push up inflation. Supply of some goods can also tighten. Watch the crude oil chart and news about key routes such as the Red Sea. It depends on how long the disruption lasts and whether other routes or suppliers can fill the gap.',
    ),
    ('supply', 'autos'): (
        'Parts delayed (such as chips) → fewer vehicles built → units sold may fall even if demand is strong',
        'A car has thousands of parts, and if even one, such as a computer chip, is missing, it cannot be finished. Supply disruptions can therefore cut production even when buyers are waiting. That can reach units sold, the autos KPI, and revenue. Watch the production figures in the monthly release and news of waiting periods. It depends on how much stock the company holds and whether it can find other suppliers.',
    ),
    ('supply', 'cement'): (
        'Disruption → imported fuel and freight costs up → cost per tonne up → margin may fall',
        'Cement makers rely on coal and petcoke, some of it imported by sea, and on freight to deliver cement. Disruptions can raise both costs, and the operating margin may fall if cement prices do not follow. Watch the coal and crude charts. It depends on how much fuel the company buys locally and how much stock it already holds.',
    ),
    ('supply', 'fmcg'): (
        'Disruption → imported inputs and freight costs up → margin may fall',
        "Some FMCG raw materials and packaging come from abroad, and all products need transport. Disruptions can raise these costs and sometimes cause shortages. That can reach the operating margin, and if products run short, volumes too. Watch the crude and palm oil charts and the company's comments on costs. It depends on how much the company sources locally.",
    ),
    ('gst', 'economy'): (
        'GST cut → lower shop prices → people may buy more → tax collections change',
        "GST is the tax charged on most goods and services, and its rates are set by the GST Council. A cut can make products cheaper and encourage buying, while a rise does the opposite. The government's tax collections also change. Watch GST Council meetings and announcements. It depends on whether companies pass the change on to customers in full.",
    ),
    ('gst', 'autos'): (
        'GST cut on vehicles → showroom prices fall → more buyers → units may rise',
        "GST is a large part of a vehicle's price, so a change in the rate moves the price buyers pay. A cut can bring buyers in, and some buyers may wait for a cut they expect. That can reach units sold, the autos KPI, and revenue. Watch GST Council decisions and the monthly sales figures around the change. It depends on whether the cut is passed on in full and on stock already sitting with dealers.",
    ),
    ('gst', 'fmcg'): (
        'GST cut on everyday goods → lower shelf prices → volumes may rise',
        "A GST cut can lower the price of everyday products and lift how much people buy, which can reach underlying volume growth, the FMCG KPI. Revenue is reported without GST, so if the company passes the cut on through lower prices, revenue per pack may fall even as more packs sell. Shops may also hold back orders around a change while old stock is relabelled. Watch the company's comments on price changes and trade stocks. It depends on how much of the cut is passed on.",
    ),
    ('gst', 'cement'): (
        'GST change on cement → price per bag changes → demand and price per tonne may move',
        'A change in the GST rate on cement changes what builders pay per bag. A cut can make building cheaper and may lift demand, which can reach tonnes sold, the cement KPI. Companies may also use the change to adjust their own prices. Watch GST Council decisions and cement price trends. It depends on how much of the change reaches customers.',
    ),
    ('inputs', 'autos'): (
        'Steel and aluminium up → cost of each vehicle up → margin may fall unless prices rise',
        'Steel and aluminium are among the biggest materials in a vehicle. When their prices rise, each vehicle costs more to make, and the operating margin may fall unless the company raises prices. Price rises can protect the margin but may slow sales. Watch the aluminium and iron ore charts and any price increases. It depends on supply contracts, which often reset only every few months, so effects can show a quarter later.',
    ),
    ('inputs', 'cement'): (
        'Coal and petcoke up → fuel cost per tonne up → margin may fall',
        "Power and fuel are among a cement maker's largest costs, because kilns burn coal or petcoke at very high temperatures. When these fuels get dearer, each tonne costs more to make, and the operating margin may fall. Watch the coal chart and the company's comments on fuel cost per tonne. It depends on the fuel mix, green power use, and stock bought earlier at lower prices.",
    ),
    ('inputs', 'fmcg'): (
        'Palm oil or copra up → material costs up → margin may fall unless prices rise → volumes may slow if they do',
        "Products like soaps, hair oils and some foods are made from palm oil, coconut (copra) and similar materials. When these prices rise, costs rise, and the operating margin may fall unless the company raises prices. If it does raise prices, revenue may grow while volumes slow, so it helps to look at both. Watch the palm oil chart and the company's price changes. It depends on hedging and stock, which can delay the effect.",
    ),
    ('tech', 'it'): (
        'Clients spend more on technology → more projects and renewals → constant-currency growth may rise',
        "Indian IT companies earn by building and running software for banks, insurers, retailers and others, mostly in the US and Europe. When those clients raise their technology budgets, more projects and contract renewals may follow. That can reach constant-currency revenue growth, the IT KPI. Watch what large client industries such as banks say about spending, and the company's deal wins. It depends on the client industries the company serves and on how new tools such as AI change the size and price of projects.",
    ),
}

EVENT_EXPLANATIONS: dict[str, tuple[str, str]] = {
    'results': (
        'Results published → actual revenue, margin and sector numbers known → compare with your forecast',
        "These are the company's official numbers for the quarter. Look at revenue growth, the operating margin and the sector KPI, and compare them with your forecast range. Read the notes for one-off items, such as a gain from selling a business, which can make a quarter look better or worse than the business really did. Watch the earnings call or presentation for the reasons behind the numbers. It depends on accounting changes and one-offs, so compare like with like.",
    ),
    'commentary': (
        'Management explains the quarter → clues on prices, volumes and costs → may change your view of the next quarter',
        "In presentations and earnings calls, managers explain what drove the numbers and what they are seeing now. Listen for price changes, volume trends, cost pressures and new plants or products. These can help you judge the next quarter's revenue, margin and KPI. Watch for numbers you can check later. It depends on the speaker: managers tend to sound hopeful, so compare their words with the reported figures.",
    ),
    'monthly_sales': (
        'Monthly units published → three months add up to the quarter → you can track the units KPI before results',
        "Some companies, especially carmakers, publish how many units they sold each month. Adding up three months gives the quarter's total, which is the autos KPI, before the full results come out. That can help you set or adjust your forecast range. Watch the release on the first day of each month. It depends on what is counted: these are usually dispatches to dealers, which can differ from what customers actually bought.",
    ),
    'order': (
        'Order won → work delivered over months or years → future revenue may rise',
        "A new order or contract means work the company expects to deliver later. Its value usually turns into revenue over the life of the contract, not all at once. Compare its size with the company's yearly revenue to judge how much it matters. Watch for the timing of delivery and any comments on its profitability. It depends on whether the order is new business or a renewal, and on its margin.",
    ),
    'price_change': (
        'Price raised → revenue per unit up → margin may improve if costs rise less → volumes may dip',
        "A price increase brings in more revenue for each unit sold, and if costs have not risen as much, the margin may improve. But higher prices can make some customers buy less or switch brands, so volumes may dip. A price cut works the other way. Watch the next sales or volume update for the effect. It depends on competitors' prices and how strong demand is.",
    ),
    'capacity': (
        'New plant starts → more can be made and sold → volumes may rise, but start-up costs may weigh on margin at first',
        'New capacity lets a company make and sell more, which can lift volumes and revenue over time. In the first months, a new plant often runs below full speed while adding depreciation and other costs, so the margin may dip before it recovers. Watch for when production starts and how quickly it fills up. It depends on whether demand is there to absorb the extra output.',
    ),
    'management': (
        'New leader → strategy may change → results may change over years, not weeks',
        "A new chief executive or managing director can bring new priorities, such as different products, markets or spending plans. The effect on revenue and margins usually shows over several years rather than in the next quarter. Watch the new leader's first statements and any changes to plans. It depends on whether the change was planned or sudden.",
    ),
    'legal': (
        'Fine, order or ruling → one-off cost or delay → profit may dip in that quarter',
        "A penalty, court ruling or regulator's order can bring a one-off cost or delay part of the business. Check whether it is a one-time charge or something that changes the business for longer. A one-off cost can lower net profit in one quarter without changing revenue or the operating margin. Watch for the company's statement on the amount and its next steps. It depends on appeals, which can take years.",
    ),
}
